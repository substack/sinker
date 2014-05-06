var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var walkDir = require('findit');
var os = require('os');

var inherits = require('inherits');
var through = require('through2');
var concat = require('concat-stream');
var split = require('split');
var mdm = require('mux-demux');
var mkdirp = require('mkdirp');

var Duplex = require('readable-stream').Duplex;
var Readable = require('readable-stream').Readable;

var version = require('./package.json').protocolVersion;

module.exports = Sinker;
inherits(Sinker, Duplex);

function Sinker (dir, opts) {
    var self = this;
    if (!(this instanceof Sinker)) return new Sinker(dir, opts);
    Duplex.call(this);
    
    this.options = opts || {};
    
    var plex = mdm(function (stream) {
        if (stream.meta === 'C') {
            stream.pipe(self.readCommands());
        }
        else self.emit('stream', stream);
    });
    this.plex = plex;
    this.plexReadable = Readable().wrap(plex);
    this.seq = 0;
    
    this._watchers = {};
    this.on('finish', function () {
        Object.keys(self._watchers).forEach(function (rel) {
            self._watchers[rel].close();
            delete self._watchers[rel];
        });
    });
    
    this.dir = dir;
    this.files = { local: {}, remote: {} };
    this.hashes = { local: {}, remote: {} };
    this._clockSkew = 0;
    this._fs = this.options.fs || fs;
    this._tmpdir = this.options.tmpdir || (os.tmpdir || os.tmpDir)();
    
    this.cmd = plex.createStream('C');
    this._startTime = Date.now();
    this.send([ 'VERSION', version, this._startTime ]);
    
    this.mode = 'PRELUDE';
    this._prelude();
}

Sinker.prototype._read = function (n) {
    var self = this;
    var buf, times = 0;
    while ((buf = self.plexReadable.read()) !== null) {
        self.push(buf);
        times ++;
    }
    if (times === 0) {
        self.plexReadable.once('readable', function () {
            self._read(n);
        });
    }
};

Sinker.prototype._write = function (buf, enc, next) {
    this.plex.write(buf);
    next();
};

Sinker.prototype._prelude = function () {
    var self = this;
    var dir = path.resolve(this.dir);
    var w = walkDir(dir, { fs: this._fs });
    var pending = 1;
    
    w.on('file', function (file, stat) {
        pending ++;
        var rel = path.relative(dir, path.resolve(dir, file));
        self._hashFile(file, function (err, hash) {
            self.files.local[rel] = {
                hash: hash,
                time: stat.mtime.valueOf()
            };
            if (!self.hashes.local[hash]) self.hashes.local[hash] = [];
            self.hashes.local[hash].push(rel);
            
            self.send([ 'HASH', rel, hash, stat.mtime.valueOf() ]);
            if (-- pending === 0) done();
        });
    });
    w.on('end', function () {
        if (-- pending === 0) done();
    });
    
    function done () {
        self.send([ 'MODE', 'SYNC' ]);
    }
};

Sinker.prototype._watch = function (rel) {
    var self = this;
    if (this.options.watch === false) return;
    var file = path.join(this.dir, rel);
    
    var w = this._fs.watch(file);
    this._watchers[rel] = w;
    var changing = false;
    
    w.on('change', function f () {
        if (changing) return;
        changing = true;
        setTimeout(onchange, 600);
    });
    
    function onchange () {
        var pending = 2, stat, hash;
        var prev = self.files.local[rel];
        
        self._fs.stat(file, function (err, stat_) {
            if (err) return abort();
            stat = stat_;
            if (-- pending === 0) done();
        });
        
        self._hashFile(file, function (err, hash_) {
            if (err) return abort();
            hash = hash_;
            if (--pending === 0) done();
        });
        
        function done () {
            self.files.local[rel] = {
                hash: hash,
                time: stat.mtime.valueOf()
            };
            if (!self.hashes.local[hash]) self.hashes.local[hash] = [];
            
            var ix = self.hashes.local[prev.hash].indexOf(rel)
            if (ix >= 0) self.hashes.local[prev.hash].splice(ix, 1);
            
            changing = false;
            self.send([ 'HASH', rel, hash, stat.mtime.valueOf() ]);
        }
        
        function abort () {
            changing = false;
        }
    }
};

Sinker.prototype._sync = function () {
    var self = this;
    this.mode = 'SYNC';
    
    var ops = [];
    var files = (function () {
        var fmap = {};
        Object.keys(self.files.local).forEach(function (key) {
            fmap[key] = true;
        });
        Object.keys(self.files.remote).forEach(function (key) {
            fmap[key] = true;
        });
        return Object.keys(fmap).sort();
    })();
    
    files.forEach(function (key) {
        var lf = self.files.local[key];
        var rf = self.files.remote[key];
        
        if (lf && rf && lf.hash !== rf.hash) {
            // TODO: intelligent diffing goes here
            //ops.push([ 'UPDATE', key ]);
            // FOR NOW: most recent stamp wins
            if (lf.time < rf.time) {
                ops.push([ 'FETCH', key ]);
            }
        }
        else if (rf && !lf && self.hashes.local[rf.hash]) {
            var lh = self.hashes.local[rf.hash][0];
            var lfm = self.files.local[lh];
            if (lfm.time > rf.time) {
                ops.push([ 'MOVE', key, lh ]);
            }
        }
        else if (rf && !lf) {
            ops.push([ 'FETCH', key ]);
        }
    });
    this.emit('ops', ops);
    
    if (this.options.write !== false) this._sendOps(ops);
};

Sinker.prototype._sendOps = function (ops) {
    var self = this;
    var pending = [];
    var fetches = {};
    
    this.on('ok', onok);
    this.on('stream', onstream);
    
    function onstream (stream) {
        if (self.options.write === false) return;
        
        if (!has(fetches, stream.meta)) return;
        var file = fetches[stream.meta];
        if (!file) return;
        fetches[stream.meta] = null; // flag to prevent duplicate writes
        
        var tmpfile = path.join(this._tmpdir, '.sinker-' + Math.random());
        var ts = self._fs.createWriteStream(tmpfile, 'utf8');
        ts.on('error', onerror);
        
        var pending = 2;
        ts.on('finish', function () {
            if (--pending === 0) rename();
        });
        stream.pipe(ts);
        
        var rfile = path.join(self.dir, file);
        var rdir = path.dirname(rfile);
        mkdirp(rdir, { fs: self._fs }, function (err) {
            if (err) return onerror(err);
            if (--pending === 0) rename();
        });
        
        function rename () {
            self._fs.rename(tmpfile, rfile, function (err) {
                if (err) return onerror(err);
                delete fetches[stream.meta];
                done();
            });
        }
        
        function onerror (err) {
            var seq = stream.meta;
            self.send([ 'ERROR', seq, String(err && err.message || err) ]);
        }
    }
    
    ops.forEach(function (op) {
        var seq = self.send(op);
        
        if (op[0] === 'FETCH') {
            fetches[seq] = op[1];
        }
        else pending.push(seq);
    });
    
    function done () {
        if (pending.length + Object.keys(fetches).length > 0) return;
        self.removeListener('ok', onok);
        self.removeListener('stream', onstream);
        if (self.mode === 'LIVE') return;
        self.emit('sync');
        
        if (self.options.watch !== false) {
            self.mode = 'LIVE';
            var rels = Object.keys(self.files.local);
            rels.forEach(function (rel) {
                self._watch(rel);
            });
        }
    }
    
    function onok (seq, rseq) {
        var ix = pending.indexOf(rseq);
        if (ix < 0) return;
        pending.splice(ix, 1);
        done();
    }
};

Sinker.prototype.execute = function (seq, cmd) {
    var self = this;
    if (cmd[0] === 'VERSION') {
        this._clockSkew = this._startTime - cmd[2];
    }
    else if (cmd[0] === 'MODE') {
        if (this.mode === 'PRELUDE' && cmd[1] === 'SYNC') {
            this._sync();
        }
    }
    else if (cmd[0] === 'HASH') {
        var file = cmd[1], hash = cmd[2];
        if (!allowed(file)) return;
        
        this.files.remote[file] = {
            hash: hash,
            time: cmd[3] + this._clockSkew
        };
        if (!this.hashes.remote[hash]) this.hashes.remote[hash] = [];
        this.hashes.remote[hash].push(file);
        
        if (this.mode === 'LIVE' && this.hashes.local[hash]) {
            var lfile = this.hashes.local[hash][0];
            this._sendOps([ [ 'MOVE', lfile, file ] ]);
        }
        else if (this.mode === 'LIVE') {
            this._sendOps([ [ 'FETCH', file ] ]);
        }
    }
    else if (cmd[0] === 'FETCH') {
        if (!allowed(cmd[1])) {
            return this.send([ 'ERROR', seq ]);
        }
        this.emit('fetch', cmd[1]);
        
        var stream = this.plex.createWriteStream(seq);
        var file = path.join(this.dir, cmd[1]);
        var rs = this._fs.createReadStream(file, { encoding: 'utf8' });
        rs.on('error', onerror);
        stream.on('error', onerror);
        rs.pipe(stream);
    }
    else if (cmd[0] === 'MOVE') {
        if (!allowed(cmd[1]) || !allowed(cmd[2])) {
            return this.send([ 'ERROR', seq, 'not allowed' ]);
        }
        if (this.options.write === false) return;
        this._move(cmd[1], cmd[2], function (err) {
            if (err) onerror(err)
            else self.send([ 'OK', seq ])
        });
    }
    else if (cmd[0] === 'OK') {
        this.emit.apply(this, [ 'ok', seq ].concat(cmd.slice(1)));
    }
    else if (cmd[0] === 'ERROR') {
        this.emit.apply(this, [ 'remote-error', seq ].concat(cmd.slice(1)));
    }
    
    function onerror (err) {
        self.send([ 'ERROR', seq, String(err && err.message || err) ]);
    }
};

Sinker.prototype._move = function (rsrc, rdst, cb) {
    var self = this;
    var src = path.join(this.dir, rsrc);
    var dst = path.join(this.dir, rdst);
    var tmpfile = path.join(this._tmpdir, '.sinker-' + Math.random());
    
    var ss = this._fs.createReadStream(src);
    var ts = this._fs.createWriteStream(tmpfile);
    ss.on('error', cb);
    ts.on('error', cb);
    
    ts.on('finish', function () {
        self._fs.rename(tmpfile, dst, function (err) {
            if (err) cb(err);
            else cb(null);
        });
    });
    ss.pipe(ts);
};

Sinker.prototype.send = function (cmd) {
    var row = [ this.seq ].concat(cmd);
    this.cmd.write(JSON.stringify(row) + '\n');
    return this.seq++;
};

Sinker.prototype.readCommands = function () {
    var self = this;
    var sp = split();
    sp.pipe(through(function (buf, enc, next) {
        try { var row = JSON.parse(buf.toString('utf8')) }
        catch (err) { return next() }
        if (!Array.isArray(row)) return next();
        
        self.execute(row[0], row.slice(1));
        next();
    }));
    return sp;
};

Sinker.prototype._hashFile = function (file, cb) {
    var h = crypto.createHash('sha256', { encoding: 'base64' });
    var rs = this._fs.createReadStream(file);
    rs.on('error', cb);
    rs.pipe(h).pipe(concat(function (hash) {
        cb(null, hash);
    }));
}

function allowed (rfile) {
    if (typeof rfile !== 'string') return false;
    if (/^[\/\\]/.test(rfile)) return false;
    if (/^\w+:/.test(rfile)) return false;
    if (/\.\./.test(rfile)) return false;
    return true;
}

function has (obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}
