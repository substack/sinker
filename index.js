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
var names = { cmd: 'C' };

module.exports = function (dir) {
    var plex = multiplex(function (err, stream, id) {
        console.log('STREAM', id);
    });
    plex._sinker = new Sinker(dir, plex);
    return plex;
};

function Sinker (dir, plex) {
    var self = this;
    if (!(this instanceof Sinker)) return new Sinker(dir, plex);
    
    this.plex = plex;
    this.dir = dir;
    this.files = { local: {}, remote: {} };
    
    this.cmd = plex.createStream(names.cmd);
    this.cmd.pipe(split()).pipe(through(function (buf, enc, next) {
        try { var row = JSON.parse(buf.toString('utf8')) }
        catch (err) { return next() }
        
        self.execute(row);
        next();
    }));
    
    var w = walkDir(dir);
    w.on('file', function (file, stat) {
        var rel = path.relative(dir, path.resolve(dir, file));
        hashFile(file, function (err, hash) {
            self.files.local[rel] = hash;
            self.send([ 'HASH', rel, hash ]);
        });
    });
}

Sinker.prototype.execute = function (cmd) {
    console.log('EXECUTE', cmd);
};

Sinker.prototype.send = function (cmd) {
    this.cmd.write(JSON.stringify(cmd) + '\n');
};

function hashFile (file, cb) {
    var h = crypto.createHash('sha256', { encoding: 'hex' });
    var rs = fs.createReadStream(file);
    rs.on('error', cb);
    rs.pipe(h).pipe(concat(function (hash) {
        cb(null, hash);
    }));
}
