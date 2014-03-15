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
    var trees = {}, pending = 2;
    
    files.forEach(function (rel) {
        var file = path.resolve(rel);
        fs.stat(file, function (err, s) {
            if (err) return stream.emit('error', err);
            withStat(file, s);
        });
    });
    
    var first = true;
    var output = through(write);
    var stream = combine(split(), output);
    return stream;
    
    function done () {
        if (-- pending !== 0) return;
        var own = flatten(trees.own);
        var other = flatten(trees.other);
        var ops = computeOps(own, other);
        console.log(ops);
    }
    
    function write (line) {
        if (first) {
            trees.other = JSON.parse(line);
            first = false;
            return done();
        }
    }
    
    function withStat (file, s) {
        if (s.isDirectory()) {
            merkleDir(file, cb);
        }
        else if (s.isFile()) {
            merkleFile(file, cb);
        }
        function cb (err, t) {
            if (err) return stream.emit('error', err);
            trees.own = t;
            output.push(JSON.stringify(t) + '\n');
            done();
        }
    }
    
    function flatten (root) {
        var files = {};
        var hashes = {};
        (function walk (node) {
            if (node.tree) {
                for (var i = 0; i < node.tree.length; i++) {
                    walk(node.tree[i]);
                }
            }
            else {
                hashes[node.hash] = node.path;
                files[node.path] = node.hash;
            }
        })(root);
        return { hashes: hashes, files: files };
    }
    
    function computeOps (own, other) {
        var ops = [];
        var keys = Object.keys(other.hashes);
        for (var i = 0; i < keys.length; i++) {
            var h = keys[i];
            var p = other.hashes[h];
            if (h === own.files[p]) continue;
            
            if (own.hashes[h]) {
                ops.push([ 'move', p, own.hashes[h] ]);
            }
            else if (!own.files[p]) {
                ops.push([ 'need', p ]);
            }
            else ops.push([ 'update', p ]);
        }
        return ops;
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
