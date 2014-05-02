var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var walkDir = require('findit');

var inherits = require('inherits');
var through = require('through2');
var concat = require('concat-stream');
var Duplex = require('readable-stream').Duplex;
var split = require('split');

var multiplex = require('multiplex');

inherits(Sinker, Duplex);
module.exports = Sinker;

var names = {
    cmd: 'C'
};

function Sinker (dir) {
    var self = this;
    if (!(this instanceof Sinker)) return new Sinker(dir);
    Duplex.call(this);
    
    this.plex = multiplex(function (err, stream, id) {
        console.log('STREAM', id);
    });
    
    var cmd = this.plex.createStream(names.cmd);
    this.cmdStream = cmd;
    cmd.pipe(split()).pipe(through(function (buf, enc, next) {
        try { var row = JSON.parse(buf.toString('utf8')) }
        catch (err) { return }
        self.execute(row);
    }));
    
    this.files = { local: {}, remote: {} };
    
    var w = walkDir(dir);
    w.on('file', function (file, stat) {
        var rel = path.relative(dir, path.resolve(dir, file));
        hashFile(file, function (err, hash) {
            self.files.local[rel] = hash;
            self.send([ 'HASH', rel, hash ]);
        });
    });
    this.on('error', function () {});
}

Sinker.prototype._write = function (buf, enc, next) {
    this.plex._write(buf, enc, next);
};

Sinker.prototype._read = function (n) {
    var self = this;
    var buf, times = 0;
    while ((buf = this.plex.read(n)) !== null) {
        times ++;
        if (!this.push(buf)) break;
    }
    if (times === 0) {
        this.plex.on('readable', function () { self.read(n) });
    }
};

Sinker.prototype.execute = function (cmd) {
    console.log('EXECUTE', cmd);
};

Sinker.prototype.send = function (cmd) {
    this.cmdStream.write(JSON.stringify(cmd) + '\n');
};

function hashFile (file, cb) {
    var h = crypto.createHash('sha256', { encoding: 'hex' });
    var rs = fs.createReadStream(file);
    rs.on('error', cb);
    rs.pipe(h).pipe(concat(function (hash) {
        cb(null, hash);
    }));
}
