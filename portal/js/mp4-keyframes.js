(function (global) {
  'use strict';

  function fourcc(bytes, off) {
    return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  }

  function headerAt(dv, bytes, off) {
    if (off + 8 > bytes.length) return null;
    var size = dv.getUint32(off);
    var type = fourcc(bytes, off + 4);
    var header = 8;
    if (size === 1) {
      if (off + 16 > bytes.length) return null;
      size = Number(dv.getBigUint64(off + 8));
      header = 16;
    } else if (size === 0) {
      size = bytes.length - off;
    }
    if (size < header) return null;
    return { offset: off, size: size, header: header, type: type, payload: off + header };
  }

  function eachChild(dv, bytes, start, end, fn) {
    var off = start;
    while (off + 8 <= end) {
      var box = headerAt(dv, bytes, off);
      if (!box || off + box.size > end) break;
      fn(box);
      off += box.size;
    }
  }

  function findChild(dv, bytes, parent, type) {
    var found = null;
    var end = parent.offset + parent.size;
    eachChild(dv, bytes, parent.payload, end, function (box) {
      if (!found && box.type === type) found = box;
    });
    return found;
  }

  async function readMoov(file) {
    var off = 0;
    for (var i = 0; i < 64 && off < file.size; i++) {
      var head = await file.slice(off, off + 16).arrayBuffer();
      var hv = new DataView(head);
      var bytes = new Uint8Array(head);
      var box = headerAt(hv, bytes, 0);
      if (!box) return null;
      if (box.type === 'moov') {
        return await file.slice(off + box.header, off + box.size).arrayBuffer();
      }
      off += box.size;
    }
    return null;
  }

  function parseVideoTrack(moov) {
    var bytes = new Uint8Array(moov);
    var dv = new DataView(moov);
    var stbl = null;
    var timescale = 0;
    eachChild(dv, bytes, 0, moov.byteLength, function (trak) {
      if (stbl || trak.type !== 'trak') return;
      var mdia = findChild(dv, bytes, trak, 'mdia');
      if (!mdia) return;
      var hdlr = findChild(dv, bytes, mdia, 'hdlr');
      if (!hdlr || fourcc(bytes, hdlr.payload + 8) !== 'vide') return;
      var mdhd = findChild(dv, bytes, mdia, 'mdhd');
      if (!mdhd) return;
      var version = bytes[mdhd.payload];
      timescale = version === 1
        ? dv.getUint32(mdhd.payload + 20)
        : dv.getUint32(mdhd.payload + 12);
      var minf = findChild(dv, bytes, mdia, 'minf');
      if (!minf) return;
      stbl = findChild(dv, bytes, minf, 'stbl');
    });

    if (!stbl || !timescale) return null;

    var stss = findChild(dv, bytes, stbl, 'stss');
    var stts = findChild(dv, bytes, stbl, 'stts');
    var ctts = findChild(dv, bytes, stbl, 'ctts');
    if (!stss || !stts) return null;

    return {
      dv: dv,
      bytes: bytes,
      timescale: timescale,
      stss: stss,
      stts: stts,
      ctts: ctts
    };
  }

  function keyframeTimes(track) {
    var dv = track.dv;
    var timescale = track.timescale;
    var syncCount = dv.getUint32(track.stss.payload + 4);
    if (!syncCount) return [];
    var sync = new Set();
    for (var s = 0; s < syncCount; s++) {
      sync.add(dv.getUint32(track.stss.payload + 8 + s * 4));
    }

    var sttsCount = dv.getUint32(track.stts.payload + 4);
    var cttsCount = 0;
    var cttsVersion = 0;
    if (track.ctts) {
      cttsVersion = track.bytes[track.ctts.payload];
      cttsCount = dv.getUint32(track.ctts.payload + 4);
    }

    var times = [];
    var sample = 0;
    var dts = 0;
    var cttsIndex = 0;
    var cttsRemaining = 0;
    var cttsOffset = 0;

    for (var e = 0; e < sttsCount; e++) {
      var at = track.stts.payload + 8 + e * 8;
      var count = dv.getUint32(at);
      var delta = dv.getUint32(at + 4);
      for (var i = 0; i < count; i++) {
        sample++;
        if (track.ctts) {
          while (cttsRemaining === 0 && cttsIndex < cttsCount) {
            var ca = track.ctts.payload + 8 + cttsIndex * 8;
            cttsRemaining = dv.getUint32(ca);
            cttsOffset = cttsVersion === 1 ? dv.getInt32(ca + 4) : dv.getUint32(ca + 4);
            cttsIndex++;
          }
          if (cttsRemaining > 0) cttsRemaining--;
        }
        if (sync.has(sample)) {
          times.push((dts + cttsOffset) / timescale);
        }
        dts += delta;
      }
    }

    times.sort(function (a, b) { return a - b; });
    return times;
  }

  async function read(file) {
    if (!file || !file.size) return [];
    var moov = await readMoov(file);
    if (!moov) return [];
    var track = parseVideoTrack(moov);
    if (!track) return [];
    return keyframeTimes(track);
  }

  global.UBMp4Keyframes = { read: read };
})(window);
