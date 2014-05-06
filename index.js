var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var walkDir = require('findit');

var inherits = require('inherits');
var through = require('through2');
var concat = require('concat-stream');
var split = require('split');
var mdm = require('mux-demux');

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
        stream.pipe(self.readCommands());
    });
    this.plex = plex;
    this.plexReadable = Readable().wrap(plex);
    this.seq = 0;
    
    this.dir = dir;
    this.files = { local: {}, remote: {} };
    this.hashes = { local: {}, remote: {} };
    this._clockSkew = 0;
    this._fs = this.options.fs || fs;
    
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
        hashFile(file, function (err, hash) {
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
            if (lfm.time < rf.time) {
                ops.push([ 'MOVE', lh, key ]);
            }
        }
        else if (rf && !lf) {
            ops.push([ 'FETCH', key ]);
        }
    });
    this.emit('ops', ops);
    
    if (this.options.write !== false) {
        ops.forEach(function (op) {
            self.send(op);
        });
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
        this.files.remote[file] = {
            hash: hash,
            time: cmd[3] + this._clockSkew
        };
        if (!this.hashes.remote[hash]) this.hashes.remote[hash] = [];
        this.hashes.remote[hash].push(file);
    }
    else if (cmd[0] === 'FETCH') {
        if (!allowed(cmd[1])) {
            return this.send([ 'ERROR', seq ]);
        }
        this.emit('fetch', cmd[1]);
        var stream = this.plex.createWriteStream(seq);
        var rs = this._fs.createReadStream(cmd[1]);
        rs.on('error', onerror);
        stream.on('error', onerror);
        rs.pipe(stream);
    }
    else if (cmd[0] === 'MOVE') {
        console.error('TODO', cmd);
    }
    
    function onerror (err) {
        self.send([ 'ERROR', seq, String(err && err.message || err) ]);
    }
};

Sinker.prototype.send = function (cmd) {
    var row = [ this.seq++ ].concat(cmd);
    this.cmd.write(JSON.stringify(row) + '\n');
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

function hashFile (file, cb) {
    var h = crypto.createHash('sha256', { encoding: 'base64' });
    var rs = fs.createReadStream(file);
    rs.on('error', cb);
    rs.pipe(h).pipe(concat(function (hash) {
        cb(null, hash);
    }));
}

function allowed (rfile) {
    var file = path.resolve(rfile);
    if (/^[\/\\]/.test(file)) return false;
    if (/^\w+:/.test(file)) return false;
    if (/\.\./.test(file)) return false;
    return true;
}
