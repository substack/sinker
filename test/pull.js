var sinker = require('../');
var path = require('path');
var net = require('net');
var test = require('tape');
var typewise = require('typewise');

var rm = require('rimraf');
var mkdirp = require('mkdirp');

rm.sync(path.join(__dirname, 'pull/b'));
mkdirp.sync(path.join(__dirname, 'pull/b'));

test('pull', function (t) {
    t.plan(6);
    
    var a = sinker(path.join(__dirname, 'pull/a'));
    var b = sinker(path.join(__dirname, 'pull/b'));
    
    a.on('ops', function (ops) {
        t.deepEqual(ops.sort(typewise.compare), []);
    });
    
    b.on('ops', function (ops) {
        t.deepEqual(ops.sort(typewise.compare), [
            [ 'FETCH', 'foo/beep.txt' ],
            [ 'FETCH', 'four.txt' ],
            [ 'FETCH', 'here.txt' ],
            [ 'FETCH', 'one.txt' ],
            [ 'FETCH', 'two.txt' ]
        ]);
    });
    b.on('sync', function () {
        var dir = path.join(__dirname, 'pull/b');
        fs.readdir(dir, function (err, files) {
            t.ifError(err);
            t.deepEqual(files, [
                'foo', 'four', 'here.txt', 'one.txt', 'two.txt'
            ]);
        });
        fs.readdir(path.join(dir, 'foo'), function (err, files) {
            t.ifError(err);
            t.deepEqual(files, [ 'beep.txt' ]);
        });
    });
    
    a.pipe(b).pipe(a);
});
