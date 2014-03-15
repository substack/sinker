var merkleDir = require('merkle-dir');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var through = require('through2');
var concat = require('concat-stream');
var combine = require('stream-combiner');
var split = require('split');

module.exports = prelude;

function prelude (files, opts) {
    if (!opts) opts = {};
    if (!Array.isArray(files)) {
        files = [ files ].filter(Boolean);
    }
    var fileId = 0, pending = files.length;;
    var root = {};
    
    files.forEach(function (rel) {
        var file = path.resolve(rel);
        fs.stat(file, function (err, s) {
            if (err) return stream.emit('error', err);
            withStat(file, s);
        });
    });
    
    var output = through(write);
    var stream = combine(split(), output);
    return stream;
    
    function write (line) {
        var row = JSON.parse(line);
        console.log(row);
    }
    
    function withStat (file, s) {
        if (s.isDirectory()) {
            merkleDir(file, cb);
        }
        else if (s.isFile()) {
            merkleFile(file, cb);
        }
        function cb (err, tree) {
            if (err) return stream.emit('error', err);
            output.push(JSON.stringify(tree) + '\n');
        }
    }
}

function merkleFile (file, cb) {
    var h = crypto.createHash('sha256', { encoding: 'hex' });
    var rs = fs.createReadStream(file);
    rs.on('error', cb);
    rs.pipe(h).pipe(concat(function (hash) {
        cb(null, { path: file, hash: hash });
    }));
}
