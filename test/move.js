var sinker = require('../');
var path = require('path');
var net = require('net');
var test = require('tape');
var fs = require('fs');
var typewise = require('typewise');

var cpr = require('cpr');
var mkdirp = require('mkdirp');

var os = require('os');
var tmpdir = path.join(
    (os.tmpdir || os.tmpDir)(),
    'sinker-test-' + Math.random()
);

var dirs = {
    a: path.join(tmpdir, 'a'),
    b: path.join(tmpdir, 'b')
};

var expected = {
    'one.txt': 'ONE\n',
    'two.txt': '222\n',
    'three.txt': 'THREE\n',
    'four.txt': 'beep boop\n',
    'foo/beep.txt': 'boop\n',
};

test('move setup', function (t) {
    t.plan(4);
    cpr(path.join(__dirname, 'move/a'), dirs.a, function (errs) {
        t.ifError(errs);
    });
    cpr(path.join(__dirname, 'move/b'), dirs.b, function (errs) {
        t.ifError(errs);
        
        // bump ctimes of files so they win:
        // wait 1 second because ctime has 1-second precision
        setTimeout(function () {
            bump(path.join(dirs.b, 'two.txt'), function (err) {
                t.ifError(err);
            });
            bump(path.join(dirs.b, 'there.txt'), function (err) {
                t.ifError(err);
            });
        }, 1000);
    });
});

test('move', function (t) {
    t.plan(2 + Object.keys(expected).length * 2);
    
    var a = sinker(dirs.a);
    var b = sinker(dirs.b);
    
    a.on('ops', function (ops) {
        t.deepEqual(ops.sort(typewise.compare), [
            [ 'FETCH', 'three.txt' ],
            [ 'FETCH', 'two.txt' ],
            [ 'MOVE', 'here.txt', 'there.txt' ]
        ]);
    });
    
    b.on('ops', function (ops) {
        t.deepEqual(ops.sort(typewise.compare), [
            [ 'FETCH', 'foo/beep.txt' ],
            [ 'FETCH', 'one.txt' ]
        ]);
    });
    
    a.on('sync', function () {
        Object.keys(expected).forEach(function (key) {
            fs.readFile(path.join(dirs.a, key), 'utf8', function (err, src) {
                t.ifError(err);
                t.equal(src, expected[key]);
            });
        });
    });
    
    b.on('sync', function () {
        Object.keys(expected).forEach(function (key) {
            fs.readFile(path.join(dirs.a, key), 'utf8', function (err, src) {
                t.ifError(err);
                t.equal(src, expected[key]);
            });
        });
    });
    
    a.pipe(b).pipe(a);
});

function bump (file, cb) {
    fs.readFile(file, 'utf8', function (err, src) {
        if (err) return cb(err);
        fs.writeFile(file, src,function (err) {
            if (err) return cb(err);
            else cb(null)
        });
    });
}
