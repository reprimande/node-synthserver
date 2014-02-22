(function() {
  var ws = (function() {
    var host = window.location.href.replace(/(http|https)(:\/\/.*?)\/.*/, 'ws$2'),
        t, socket;
    var connect = function() {
      socket = new WebSocket(host + '/socket');
      //WS Setup
      socket.onopen = function() {
        console.log('onopen');
        if (t) clearInterval(t);
        socket.binaryType = 'arraybuffer';
      };
      socket.onerror = function() {
        console.log('connection error.');
      };
      socket.onclose = function() {
        console.log('connection close.');
        t = setInterval(function() {
          connect();
        }, 500);
      };
      socket.onmessage = function(message) {
        var data = message.data,
            json;
        if ($.type(data) === "string") {
          json = JSON.parse(data);
          if (json.message === "freq") {
            $('#freq')[0].value = json.value;
          } else if (json.message === "lfo") {
            $('#lfo')[0].value = json.value;
          } else if (json.message === "depth") {
            $('#depth')[0].value = json.value;
          }
        } else {
          listener.setAudioBuffer(data);
        }
      };
    };
    connect();
    return {
      send: function(arg) {
        socket.send(arg);
      }
    };
  })();

  var BUFFER_LENGTH = 2048,
      ctx = new webkitAudioContext();

  var AudioListener = function(ctx, bufferLength) {
    var self = this;
    this.ctx = ctx;
    this.bufferLength = bufferLength;
    this.chNum = 2;
    this.listenBuffers = [];

    this.processNode = ctx.createJavaScriptNode(this.bufferLength, 2, 2);
    this.processNode.onaudioprocess = function(e) {
      if (self.listenBuffers.length > 0) {
        var currentBuffer = self.listenBuffers.shift();
        var bufferL = (currentBuffer[0] || new Float32Array(self.bufferLength));
        var bufferR = (currentBuffer[1] || new Float32Array(self.bufferLength));
        e.outputBuffer.getChannelData(0).set(bufferL);
        e.outputBuffer.getChannelData(1).set(bufferR);
      }
    };
  };
  AudioListener.prototype = {
    setAudioBuffer: function(buffer) {
      var view = new DataView(buffer),
          result = new Array(this.chNum),
          offset = 0, i, val;
      result[0] = new Float32Array(this.bufferLength);
      result[1] = new Float32Array(this.bufferLength);
      for (i = 0; i < this.bufferLength; i++) {
        val = view.getFloat32(offset);
        result[0][i] = val;
        result[1][i] = view.getFloat32(offset);
        offset += 4;
      }
      this.listenBuffers.push(result);
    },
    connect: function(node) {
      this.processNode.connect(node);
    }
  };

  var Visualizer = function(ctx, canvasName) {
    this.analyserNode = ctx.createAnalyser();
    this.canvas = document.getElementById(canvasName);
    this.ctx = this.canvas.getContext('2d');

    this.resize();

    this.timeDomainByteData = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.freqDomainByteData = new Uint8Array(this.analyserNode.frequencyBinCount);

    this.isAnalyze = false;
    this.animation = function(fn) {
      var requestAnimationFrame = window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame;
      requestAnimationFrame(fn);
    };
    var self = this;
    this.analyze = function() {
      self.analyserNode.getByteTimeDomainData(self.timeDomainByteData);
      self.analyserNode.getByteFrequencyData(self.freqDomainByteData);

      self.ctx.clearRect(0, 0, self.canvas.width, self.canvas.height);
      self.ctx.beginPath();
      self.ctx.fillStyle = 'black';
      self.ctx.rect(0, 0, self.canvas.width, self.canvas.height);
      self.ctx.fill();

      self.drawTimeDomain(self.timeDomainByteData);
      self.drawFreqDomain(self.freqDomainByteData);
      if (self.isAnalyze) {
        self.animation(self.analyze);
      }
    };
  };
  Visualizer.prototype = {
    start: function() {
      this.isAnalyze = true;
      this.analyze();
    },
    stop: function() {
      this.isAnalyze = false;
    },
    drawTimeDomain: function(data) {
      var canvas = this.canvas;
      var ctx = this.ctx;

      var value;
      ctx.beginPath();
      ctx.moveTo(0, -999);
      for (var i = 0; i < data.length; i++) {
        value = data[i] - 128 + canvas.height / 2;
            ctx.lineTo(i, value);
      }
      ctx.moveTo(0, 999);
      ctx.closePath();
      ctx.strokeStyle = 'yellow';
      ctx.stroke();
    },
    drawFreqDomain: function(data) {
      var canvas = this.canvas;
      var ctx = this.ctx;

      ctx.beginPath();
      var len = data.length;
      for (var i = 0; i < canvas.width; i++) {
        var index = (len / canvas.width * i) | 0;
        var value = (canvas.height - (data[index] || 0) / 256 * canvas.height) | 0;
        if (i == 0) ctx.moveTo(0, value);
        ctx.lineTo(i + 1, value);
      }
      ctx.strokeStyle = 'blue';
      ctx.stroke();
    },
    connect: function(node) {
      this.analyserNode.connect(node);
    },
    resize: function() {
      this.canvas.width = document.documentElement.clientWidth;
      this.canvas.height = document.documentElement.clientHeight;
    }
  };

  var listener = new AudioListener(ctx, BUFFER_LENGTH);
  var visualizer = new Visualizer(ctx, 'scope-view', 'scope-view');
  var volumeNode = ctx.createGainNode();

  listener.connect(volumeNode);
  volumeNode.connect(visualizer.analyserNode);
  visualizer.connect(ctx.destination);
  visualizer.start();

  // Event Setup
  $('#freq').bind('change', function(e){
    ws.send(JSON.stringify({ message: "freq", value: this.valueAsNumber }));
  });
  $('#lfo').bind('change', function(e){
    ws.send(JSON.stringify({ message: "lfo", value: this.valueAsNumber }));
  });
  $('#depth').bind('change', function(e){
    ws.send(JSON.stringify({ message: "depth", value: this.valueAsNumber }));
  });
  $('#volume').bind('change', function(e){
    volumeNode.gain.value = this.valueAsNumber;
  });

  var key2midi = {
    65: 0, 87: 1, 83: 2, 69: 3,  68: 4, 70: 5, 84: 6,
    71: 7, 89: 8, 72: 9, 85: 10, 74: 11 };
  var octave = 6;
  $(window).keydown(function(e) {
    var midinote = key2midi[e.keyCode];
    if (midinote === (void 0)) return;
    var freq = 440.0 * Math.pow(2.0, (midinote + (octave * 12) - 69.0) / 12.0);
    console.log(freq);
    ws.send(JSON.stringify({ message: "trigger", value: freq }));
  });

  $(window).resize(function(){
    visualizer.resize();
  });
})();
