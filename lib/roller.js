var fs = require('fs');
var rolling = require('rolling-checksum');
var Transform = require('readable-stream/transform');
var combine = require('stream-combiner');
var through = require('through2');
var inherits = require('inherits');

module.exports = function (opts) {
    if (!opts) opts = {};
    var blockSize = opts.blockSize || 1024;
    var roll = rolling(blockSize, blockSize);
    
    var padder = new Padder(blockSize);
    var packer = through({ objectMode: true }, write);
    return combine(padder, roll, packer);
    
    function write (row, enc, next) {
        var buf = new Buffer(4);
        buf.writeUInt32BE(row, 0, true);
        this.push(buf);
        next();
    }
};

inherits(Padder, Transform);
function Padder (size) {
    Transform.call(this);
    this.size = size;
    this.wrote = 0;
}

Padder.prototype._transform = function (buf, enc, next) {
    this.push(buf);
    this.wrote += buf.length;
    next();
};

Padder.prototype._flush = function (next) {
    var zeros = new Buffer(this.size - this.wrote % this.size);
    zeros.fill(0);
    this.push(zeros);
    this.push(null);
    next();
};
