var sinker = require('../');
var path = require('path');
var net = require('net');
var test = require('tape');

test(function (t) {
    var a = sinker(path.join(__dirname, 'ops/a'));
    var b = sinker(path.join(__dirname, 'ops/b'));
    
    a.pipe(b).pipe(a);
});
