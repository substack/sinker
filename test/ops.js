var sinker = require('../');
var path = require('path');
var net = require('net');
var test = require('tape');
var fs = require('fs');
var typewise = require('typewise');

// bump ctimes so that b's versions win:
var twofile = path.join(__dirname, 'ops/b/two.txt');
fs.writeFileSync(twofile, fs.readFileSync(twofile));

var therefile = path.join(__dirname, 'ops/b/there.txt');
fs.writeFileSync(therefile, fs.readFileSync(therefile));

test('verify operation lists', function (t) {
    t.plan(2);
    
    var a = sinker(path.join(__dirname, 'ops/a'), { write: false });
    var b = sinker(path.join(__dirname, 'ops/b'), { write: false });
    
    a.on('ops', function (ops) {
        t.deepEqual(ops.sort(typewise.compare), [
            [ 'FETCH', 'three.txt' ],
            [ 'FETCH', 'two.txt' ]
        ]);
    });
    
    b.on('ops', function (ops) {
        t.deepEqual(ops.sort(typewise.compare), [
            [ 'FETCH', 'foo/beep.txt' ],
            [ 'FETCH', 'one.txt' ],
            [ 'MOVE', 'here.txt', 'there.txt' ]
        ]);
    });
    
    a.pipe(b).pipe(a);
});
