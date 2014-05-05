var sinker = require('../');
var path = require('path');
var net = require('net');
var test = require('tape');
var fs = require('fs');

// bump the ctime on two.txt:
var twofile = path.join(__dirname, 'ops/b/two.txt');
fs.writeFileSync(twofile, fs.readFileSync(twofile));

test('verify operation lists', function (t) {
    t.plan(2);
    
    var a = sinker(path.join(__dirname, 'ops/a'));
    var b = sinker(path.join(__dirname, 'ops/b'));
    
    a.on('ops', function (ops) {
        t.deepEqual(ops, [
            [ 'FETCH', 'two.txt' ],
            [ 'FETCH', 'three.txt' ],
            [ 'MOVE', 'here.txt', 'there.txt' ]
        ]);
    });
    
    b.on('ops', function (ops) {
        t.deepEqual(ops, [
            [ 'FETCH', 'one.txt' ],
            [ 'FETCH', 'foo/beep.txt' ]
        ]);
    });
    
    a.pipe(b).pipe(a);
});
