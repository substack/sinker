var sinker = require('../');
var path = require('path');
var net = require('net');
var test = require('tape');

test('verify operation lists', function (t) {
    t.plan(2);
    
    var a = sinker(path.join(__dirname, 'ops/a'));
    var b = sinker(path.join(__dirname, 'ops/b'));
    
    a.on('ops', function (ops) {
        t.deepEqual(ops, [
            [ 'UPDATE', 'two.txt' ],
            [ 'FETCH', 'three.txt' ],
            [ 'MOVE', 'here.txt', 'three.txt' ]
        ]);
    });
    
    b.on('ops', function (ops) {
        t.deepEqual(ops, [
            [ 'FETCH', 'one.txt' ],
            [ 'UPDATE', 'two.txt' ],
            [ 'FETCH', 'foo/beep.txt' ]
        ]);
    });
    
    a.pipe(b).pipe(a);
});
