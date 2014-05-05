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

function Sinker (dir) {
    var self = this;
    if (!(this instanceof Sinker)) return new Sinker(dir);
    Duplex.call(this);
    
    var plex = mdm(function (stream) {
        stream.pipe(self.readCommands());
    });
    this.plex = plex;
    this.plexReadable = Readable().wrap(plex);
    
    this.dir = dir;
    this.files = { local: {}, remote: {} };
    this.hashes = { local: {}, remote: {} };
    this._clockSkew = 0;
    
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
    var w = walkDir(dir);
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
    Object.keys(this.files.local).forEach(function (key) {
        var lf = self.files.local[key];
        var rf = self.files.remote[key];
        if (!rf && self.hashes[lf.hash]) {
            ops.push([ 'COPY', key, self.hashes[lf.hash] ]);
        }
        else if (!rf) {
            ops.push([ 'FETCH', lf.hash, key ]);
        }
    });
    console.log(ops);
};

Sinker.prototype.execute = function (cmd) {
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
};

Sinker.prototype.send = function (cmd) {
    this.cmd.write(JSON.stringify(cmd) + '\n');
};

Sinker.prototype.readCommands = function () {
    var self = this;
    var sp = split();
    sp.pipe(through(function (buf, enc, next) {
        try { var row = JSON.parse(buf.toString('utf8')) }
        catch (err) { return next() }
        
        self.execute(row);
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
