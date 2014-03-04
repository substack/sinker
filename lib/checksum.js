var roller = require('./lib/roller.js');
var finder = require('findit');
var fs = require('fs');
var through = require('through2');
var concat = require('concat-stream');
var crypto = require('crypto');

module.exports = function (files, opts) {
    if (!opts) opts = {};
    if (!Array.isArray(files)) {
        files = [ files ].filter(Boolean);
    }
    var fileId = 0;
    
    files.forEach(function (file) {
        fs.stat(file, function (err, s) {
            if (err) stream.emit('error', err)
            else withStat(file, s)
        });
    });
    
    function withStat (file, s) {
        if (s.isDirectory()) {
            var find = finder(file);
            //var r = roller(dir);
        }
        else if (s.isFile()) {
            var roll = roller({ blockSize: opts.blockSize });
            var pack = packer(fileId++, { minSize: opts.minFrameSize });
            var rs = fs.createReadStream(file);
            rs.pipe(roll).pipe(pack).pipe(stream, { end: false });
        }
    }
    
    var stream = through();
    return stream;
};

function packer (id, opts) {
    if (!opts) opts = {};
    var size = opts.minSize || 512;
    
    var buffered = 0, buffer;
    var output = through(write, end);
    var ended = false, gotHash = false;
    output.setHash = function (hash) {
        gotHash = true;
        output.push(Buffer.concat([
            Buffer(id + '!md5!'), hash
        ]));
        if (ended) output.push(null);
    };
    return output;
    
    function write (buf, enc, next) {
        if (buffered + buf.length < size) {
            buffer = buffer ? Buffer.concat([ buffer, buf ]) : buf;
            buffered += buf.length;
            return next();
        }
        if (buffer) {
            buf = Buffer.concat([ buffer, buf ]);
            buffered = 0;
            buffer = null;
        }
        push.call(this, buf);
        next();
    }
    
    function end (next) {
        ended = true;
        if (buffer) push.call(this, buffer);
        push.call(this, new Buffer(0));
        if (gotHash) this.push(null);
        next();
    }
    
    function push (buf) {
        this.push(Buffer.concat([
            Buffer(id + '!' + buf.length + '!'), buf
        ]));
    }
}
