var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var walkDir = require('findit');

var inherits = require('inherits');
var through = require('through2');
var concat = require('concat-stream');
var Duplex = require('readable-stream').Duplex;
var split = require('split');

var version = require('./package.json').version;

var mdm = require('mux-demux');

module.exports = function (dir) {
    return new Sinker(dir).plex;
};

function Sinker (dir) {
    var self = this;
    if (!(this instanceof Sinker)) return new Sinker(dir);
    
    var plex = mdm(function (stream) {
        stream.pipe(self.readCommands());
    });
    this.plex = plex;
    this.dir = dir;
    this.files = { local: {}, remote: {} };
    
    this.cmd = plex.createStream('C');
    this.send([ 'VERSION', version, Date.now() ]);
    
    this._prelude();
}

Sinker.prototype._prelude = function () {
    var self = this;
    var dir = this.dir;
    var w = walkDir(dir);
    var pending = 1;
    
    w.on('file', function (file, stat) {
        pending ++;
        var rel = path.relative(dir, path.resolve(dir, file));
        hashFile(file, function (err, hash) {
            self.files.local[rel] = hash;
            self.send([ 'HASH', rel, hash ]);
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

Sinker.prototype.execute = function (cmd) {
    console.log('EXECUTE', cmd);
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
    var h = crypto.createHash('sha256', { encoding: 'hex' });
    var rs = fs.createReadStream(file);
    rs.on('error', cb);
    rs.pipe(h).pipe(concat(function (hash) {
        cb(null, hash);
    }));
}
