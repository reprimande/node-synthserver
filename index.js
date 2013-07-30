var express = require('express'),
    http = require('http'),
    app = express(),
    WebSocketServer = require('ws').Server,
    stream = require('stream'),
    Readable = stream.Readable,
    Writable = stream.Writable,
    util = require('util');

var SinOsc = function(freq) {
  this.phase = 0;
  this.freq = freq;
  this.mod = 0;
  this.depth = 0;
  this.samplerate = 44100;
};
SinOsc.prototype = {
  generate: function() {
    var val = Math.sin(Math.PI * 2 * this.phase) * 0.5;
    var step = (this.freq + (this.mod * this.depth)) / this.samplerate;
    this.phase += step;
    return val;
  }
};
var sine = new SinOsc(1000);
var lfo = new SinOsc(0.5);
var SynthServer = function() {
  var self = this;
  Readable.call(this);
  setImmediate(function() {
    self.loop();
  });
};
util.inherits(SynthServer, Readable);
SynthServer.prototype._read = function(n) {
  var self = this;
  setImmediate(function() {
    self.loop();
  });
};

SynthServer.prototype.loop = function() {
  var self = this,
      bufLen = 2048,
      input = new Float32Array(bufLen),
      arrayBuffer = new ArrayBuffer(bufLen * 2 * 4),
      view = new DataView(arrayBuffer),
      offset = 0;

  for (var i = 0; i < bufLen; i++) {
    sine.mod = lfo.generate();
    var val = sine.generate();
    input[i] = val;
  }

  for (var i = 0; i < 2; i++) {
    for (var j = 0; j < bufLen; j++) {
      view.setFloat32(offset, input[j]);
      offset += 4;
    }
  }
  if (this.push(new Buffer(new Uint8Array(view.buffer)))) {
    setImmediate(function() {
      self.loop();
    });
  }
};

var SocketWriter = function(ws, opts) {
  var self = this;
  Writable.call(self, opts);
  self.sockets = [];
};
util.inherits(SocketWriter, Writable);
SocketWriter.prototype._write = function(chunk, encoding, cb) {
  var self = this;
  for (var i = 0; i < this.sockets.length; i++) {
    this.sockets[i].send(chunk, {binary: true, mask: false});
  }
  setTimeout(function() {
    cb();
  }, 2048 / 44100 * 1000 - 1);
};
SocketWriter.prototype.add = function(ws) {
  this.sockets.push(ws);
  console.log("SocketWriter::add", "current conections:", this.sockets.length);
};
SocketWriter.prototype.remove = function(ws) {
  for (var i = 0; i < this.sockets.length; i++) {
    if (this.sockets[i] === ws) {
      this.sockets.splice(i, 1);
      break;
    }
  }
  console.log("SocketWriter::remove", "current conections:", this.sockets.length);
};

var synth = new SynthServer();

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});
app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});
app.configure('production', function(){
  app.use(express.errorHandler());
});
app.get('/', function(req, res){
  res.render('index');
});

var server = http.createServer(app);
var socket = new WebSocketServer({server:server, path:'/socket'});

var writer = new SocketWriter();
synth.pipe(writer);

socket.on('connection', function(ws) {
  console.log('connect!!');
  writer.add(ws);
  ws.on('message', function(req, flags) {
    if (!flags.binary) {
      var data = JSON.parse(req);
      var message = data.message;
      if (message === 'freq') {
        var freq = data.value;
        sine.freq = freq;
      } else if (message === 'lfo') {
        var freq = data.value;
        lfo.freq = freq;
      }else if (message === 'depth') {
        var depth = data.value;
        sine.depth = depth;
      }
    }
  });

  ws.on('close', function() {
    console.log('close');
    writer.remove(ws);
  });

  ws.on('e', function(e) {
    console.log('error:', e);
  });
});

server.listen(3000);
console.log("start synth server.");
