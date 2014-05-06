var sinker = require('../');
var path = require('path');
var net = require('net');
var test = require('tape');
var fs = require('fs');
var typewise = require('typewise');

// bump the ctime on two.txt so that b's version wins:
var twofile = path.join(__dirname, 'ops/b/two.txt');
fs.writeFileSync(twofile, fs.readFileSync(twofile));

test('verify operation lists', function (t) {
    t.plan(2);
    
    var a = sinker(path.join(__dirname, 'ops/a'), { write: false });
    var b = sinker(path.join(__dirname, 'ops/b'), { write: false });
    
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
    
    a.pipe(b).pipe(a);
});
