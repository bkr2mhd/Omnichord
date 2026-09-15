"use strict";

const NOTES=["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const HARP_KEYS={
  "Digit1":0,"Digit2":1,"Digit3":2,"Digit4":3,"Digit5":4,"Digit6":5,"Digit7":6,"Digit8":7,"Digit9":8,"Digit0":9,"Minus":10,"Equal":11,
  "Numpad1":0,"Numpad2":1,"Numpad3":2,"Numpad4":3,"Numpad5":4,"Numpad6":5,"Numpad7":6,"Numpad8":7,"Numpad9":8,"Numpad0":9
};

const SEVENTH_TYPES={
  dominant:{label:"7TH",suffix:"7",intervals:[0,4,7,10]},
  major:{label:"MAJ7",suffix:"maj7",intervals:[0,4,7,11]},
  minor:{label:"MIN7",suffix:"m7",intervals:[0,3,7,10]}
};

const CHORD_TYPES=[
  {id:"major",label:"MAJ",suffix:"",intervals:[0,4,7]},
  {id:"minor",label:"MIN",suffix:"m",intervals:[0,3,7]},
  {id:"diminished",label:"DIM",suffix:"°",intervals:[0,3,6]}
];

const MODES={
  chromatic:{label:"Chromatic",intervals:[],qualities:[]},
  major:{label:"Major",intervals:[0,2,4,5,7,9,11],qualities:["major","minor","minor","major","major","minor","diminished"]},
  dorian:{label:"Dorian",intervals:[0,2,3,5,7,9,10],qualities:["minor","minor","major","major","minor","diminished","major"]},
  phrygian:{label:"Phrygian",intervals:[0,1,3,5,7,8,10],qualities:["minor","major","major","minor","diminished","major","minor"]},
  lydian:{label:"Lydian",intervals:[0,2,4,6,7,9,11],qualities:["major","major","minor","diminished","major","minor","minor"]},
  mixolydian:{label:"Mixolydian",intervals:[0,2,4,5,7,9,10],qualities:["major","minor","diminished","major","minor","minor","major"]},
  minor:{label:"Minor",intervals:[0,2,3,5,7,8,10],qualities:["minor","diminished","major","minor","minor","major","major"]},
  locrian:{label:"Locrian",intervals:[0,1,3,5,6,8,10],qualities:["diminished","major","minor","minor","major","major","minor"]}
};

const PATTERNS={
  rock:{sub:4,len:16,k:[0,8],s:[4,12],h:[0,2,4,6,8,10,12,14]},
  waltz:{sub:4,len:12,k:[0],s:[4,8],h:[]},
  blues_shuffle:{sub:3,len:12,k:[0,6],s:[3,9],h:[0,1,2,3,4,5,6,7,8,9,10,11]},
  kalamatianos:{sub:2,len:7,k:[0,3,5],s:[2],h:[1,4,6]},
  take_five:{sub:4,len:20,k:[0,12],s:[8],h:[4,16]}
};

let selectedKey=null;
let selectedMode="chromatic";
let selectedSeventhType="dominant";
let currentRoot=0;
let currentType="major";
let currentSeventhType="dominant";
let chordPicker="sustain";
let audio=null;
let rhythmTimer=null;
let rhythmStep=0;
let playing=false;
let harpDragging=false;
let activePointerId=null;
let lastLane=-1;
let sustainActive=false;
let sustainNodes=[];

let chromaticHighlightState = 0;
let chromaticHighlights = new Set();

let isRecording = false;
let recordStartTime = 0;
let recordedEvents = [];
let sustainMidiNotes = [];

function recordMidiEvent(status, note, velocity) {
  if (!isRecording) return;
  const timeMs = Math.max(0, performance.now() - recordStartTime);
  recordedEvents.push({ timeMs, status, note, velocity });
}

function writeVarLen(val) {
  let buffer = [];
  let v = val;
  buffer.push(v & 0x7F);
  while ((v >>= 7) > 0) {
    buffer.unshift((v & 0x7F) | 0x80);
  }
  return buffer;
}

function buildMidiBlob(events) {
  events.sort((a, b) => a.timeMs - b.timeMs);
  const PPQN = 480;
  const BPM = 120;
  let trackBytes = [];

  trackBytes.push(0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20);

  let lastTicks = 0;
  events.forEach(e => {
    let currentTicks = Math.round((e.timeMs * PPQN * (BPM / 60)) / 1000);
    let deltaTicks = Math.max(0, currentTicks - lastTicks);
    lastTicks = currentTicks;

    trackBytes.push(...writeVarLen(deltaTicks));
    trackBytes.push(e.status, e.note, e.velocity);
  });

  trackBytes.push(0x00, 0xFF, 0x2F, 0x00);

  let trackLen = trackBytes.length;
  let headerTrack = [
    0x4D, 0x54, 0x72, 0x6B,
    (trackLen >> 24) & 0xFF, (trackLen >> 16) & 0xFF,
    (trackLen >> 8) & 0xFF, trackLen & 0xFF
  ];

  let headerChunk = [
    0x4D, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    (PPQN >> 8) & 0xFF, PPQN & 0xFF
  ];

  const fullBuffer = new Uint8Array([...headerChunk, ...headerTrack, ...trackBytes]);
  return new Blob([fullBuffer], { type: "audio/midi" });
}

function getChordWave(){
  const el = document.getElementById("chordWave");
  return el ? el.value : "square";
}

function getHarpWave(){
  const el = document.getElementById("harpWave");
  return el ? el.value : "square";
}

function getPianoWave(){
  const el = document.getElementById("pianoWave");
  return el ? el.value : "sine";
}

function getChordRelease(){
  return Number(document.getElementById("chordRelease").value);
}

function getHarpRelease(){
  return Number(document.getElementById("harpRelease").value);
}

function getPianoRelease(){
  return Number(document.getElementById("pianoRelease").value);
}

function chordDef(type, seventhType){
  if(type === "7"){
    const st = seventhType || currentSeventhType || (selectedSeventhType === "all" ? "dominant" : selectedSeventhType);
    return SEVENTH_TYPES[st] || SEVENTH_TYPES.dominant;
  }
  return CHORD_TYPES.find(c => c.id === type) || CHORD_TYPES[0];
}

function label(root, type, seventhType){
  if(type === "7"){
    const st = seventhType || currentSeventhType || (selectedSeventhType === "all" ? "dominant" : selectedSeventhType);
    const definition = SEVENTH_TYPES[st] || SEVENTH_TYPES.dominant;
    return NOTES[root] + definition.suffix;
  }
  return type === "diminished" ? NOTES[root] + "°" : NOTES[root] + chordDef(type).suffix;
}

function getFullChordName(root, type, seventhType){
  const rootName = NOTES[root];
  if(type === "major") return rootName + " Major";
  if(type === "minor") return rootName + " Minor";
  if(type === "diminished") return rootName + " Diminished";
  if(type === "7"){
    const st = seventhType || currentSeventhType || (selectedSeventhType === "all" ? "dominant" : selectedSeventhType);
    if(st === "dominant") return rootName + " Dominant 7th";
    if(st === "major") return rootName + " Major 7th";
    if(st === "minor") return rootName + " Minor 7th";
  }
  return label(root, type, seventhType);
}

function notesFor(root, type, seventhType){
  return chordDef(type, seventhType).intervals.map(i => NOTES[(root + i) % 12]);
}

function renderTabs(){
  const modeTabs=document.getElementById("modeTabs");
  modeTabs.innerHTML="";
  Object.entries(MODES).forEach(([id,mode])=>{
    const b=document.createElement("button");
    b.type="button";
    b.className="key-tab-sm"+(selectedMode===id?" active":"");
    b.textContent=mode.label;
    b.addEventListener("pointerdown",(e)=>{
      e.preventDefault();
      const prevMode=selectedMode;
      selectedMode=id;
      if(prevMode==="chromatic" && id!=="chromatic"){
        selectedKey=currentRoot;
      }
      if(id==="chromatic"){
        selectedKey=null;
      }
      render();
    });
    modeTabs.appendChild(b);
  });

  const keyTabs=document.getElementById("keyTabs");
  keyTabs.innerHTML="";
  if(selectedMode==="chromatic"){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chromatic-highlight-ctrl-btn";
    if(chromaticHighlightState === 0){
      btn.textContent = "+ Highlight Chords";
    } else if(chromaticHighlightState === 1){
      btn.textContent = "✓ Lock Highlights";
      btn.style.background = "#3a3a3c";
    } else {
      btn.textContent = "✕ Clear Highlights";
      btn.style.background = "#2c2c2e";
    }
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if(chromaticHighlightState === 0){
        chromaticHighlightState = 1;
      } else if(chromaticHighlightState === 1){
        chromaticHighlightState = 2;
      } else {
        chromaticHighlightState = 0;
        chromaticHighlights.clear();
      }
      renderTabs();
      applyScaleHighlights();
    });
    keyTabs.appendChild(btn);
  } else {
    NOTES.forEach((n,i)=>{
      const b=document.createElement("button");
      b.type="button";
      b.className="key-tab-sm"+(selectedKey===i?" active":"");
      b.textContent=n;
      b.addEventListener("pointerdown",(e)=>{
        e.preventDefault();
        selectedKey=i;
        render();
      });
      keyTabs.appendChild(b);
    });
  }
}

function makeChordButton(root, type, seventhType = null){
  const b = document.createElement("button");
  const isMini = seventhType && selectedSeventhType === "all";
  b.className = "chord" + (isMini ? " chord-mini" : "");
  b.type = "button";
  b.dataset.root = root;
  b.dataset.type = type;
  if(seventhType) b.dataset.seventhType = seventhType;

  b.innerHTML = `<span class="chord-name">${label(root, type, seventhType)}</span>`;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if(selectedMode === "chromatic" && chromaticHighlightState === 1){
      const key = `${root}-${type}${seventhType ? '-' + seventhType : ''}`;
      if(chromaticHighlights.has(key)){
        chromaticHighlights.delete(key);
      } else {
        chromaticHighlights.add(key);
      }
      applyScaleHighlights();
    } else {
      selectChord(root, type, seventhType);
    }
  });
  return b;
}

function renderChromatic(){
  const area=document.getElementById("chordArea");
  area.innerHTML="";
  const wrapper=document.createElement("div");
  wrapper.className="chord-sections";

  CHORD_TYPES.forEach(type => {
    const section = document.createElement("div");
    section.className = "section";
    const chords = document.createElement("div");
    chords.className = "chords";
    for(let root = 0; root < 12; root++){
      chords.appendChild(makeChordButton(root, type.id));
    }
    section.appendChild(chords);
    wrapper.appendChild(section);
  });

  if(selectedSeventhType === "all"){
    const section = document.createElement("div");
    section.className = "section section-split";
    
    const splitContainer = document.createElement("div");
    splitContainer.className = "split-container";

    const sub7Types = ["dominant", "major", "minor"];
    sub7Types.forEach(st => {
      const subChords = document.createElement("div");
      subChords.className = "chords sub-chords";
      for(let root = 0; root < 12; root++){
        subChords.appendChild(makeChordButton(root, "7", st));
      }
      splitContainer.appendChild(subChords);
    });

    section.appendChild(splitContainer);
    wrapper.appendChild(section);
  } else {
    const section = document.createElement("div");
    section.className = "section";
    const chords = document.createElement("div");
    chords.className = "chords";
    for(let root = 0; root < 12; root++){
      chords.appendChild(makeChordButton(root, "7", selectedSeventhType));
    }
    section.appendChild(chords);
    wrapper.appendChild(section);
  }

  area.appendChild(wrapper);
  applyScaleHighlights();
  syncHeights();
}

function selectChord(root, type, seventhType = null){
  if(!seventhType && type === "7"){
    seventhType = (selectedSeventhType === "all") ? "dominant" : selectedSeventhType;
  }
  const isSame = (root === currentRoot && type === currentType && (type !== "7" || seventhType === currentSeventhType));
  currentRoot = root;
  currentType = type;
  if(type === "7") currentSeventhType = seventhType || "dominant";
  handleChordPlay(isSame);
}

function handleChordPlay(isSame) {
  if (chordPicker === "mute") {
    stopSustain();
    updateInfo(true);
    return;
  }
  if (chordPicker === "sustain" || chordPicker === "legato") {
    if (isSame && sustainActive) {
      stopSustain();
      updateInfo(false);
    } else {
      startSustain();
      updateInfo(true);
    }
  } else {
    stopSustain();
    updateInfo(true);
    playChordIntervals(getPreviewIntervals());
  }
}

function lightenHex(hex, amount = 40) {
  let c = hex.replace('#','');
  if(c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  const r = Math.min(255, ((num >> 16) & 255) + amount);
  const g = Math.min(255, ((num >> 8) & 255) + amount);
  const b = Math.min(255, (num & 255) + amount);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function initPiano(){
  const container = document.getElementById("pianoKeyboard");
  if(!container) return;
  container.innerHTML = "";
  for(let i = 0; i < 24; i++){
    const midi = 60 + i;
    const noteIdx = i % 12;
    const isBlack = [1, 3, 6, 8, 10].includes(noteIdx);
    const key = document.createElement("button");
    key.className = "piano-key" + (isBlack ? " is-black" : "");
    key.dataset.midi = midi;
    
    const textSpan = document.createElement("span");
    textSpan.className = "piano-key-text";
    textSpan.textContent = NOTES[noteIdx];
    key.appendChild(textSpan);
    
    key.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      resumeAudio();
      const pianoVolFactor = Number(document.getElementById("pianoVolume").value)/100;
      const vol = 0.16 * pianoVolFactor;
      playTone(midi, 0.4, vol, null, getPianoWave(), getPianoRelease());
    });
    
    container.appendChild(key);
  }
}

function updatePianoHighlights(){
  const keys = document.querySelectorAll(".piano-key");

  if (selectedMode === "chromatic") {
    const manuallyHighlightedRoots = new Set();
    chromaticHighlights.forEach(keyStr => {
      const parts = keyStr.split("-");
      manuallyHighlightedRoots.add(Number(parts[0]));
    });

    keys.forEach(key => {
      const midi = Number(key.dataset.midi);
      const noteIdx = (midi - 60) % 12;
      const isBlack = key.classList.contains("is-black");
      const textSpan = key.querySelector(".piano-key-text");
      
      const isManuallyHighlightedRoot = manuallyHighlightedRoots.has(noteIdx);

      key.style.background = isBlack ? "#121214" : "#ffffff";
      key.style.border = isBlack ? "1px solid #2c2c2e" : "1px solid #d1d1d6";

      if (isManuallyHighlightedRoot) {
        key.classList.add("has-note");
        textSpan.style.color = "#D33682";
        textSpan.style.fontWeight = "800";
      } else {
        key.classList.remove("has-note");
        textSpan.style.color = "transparent";
      }
    });
  } else {
    const modeDef = MODES[selectedMode];
    const degreeColors = ["#D33682","#CB4B16","#B58900","#859900","#2AA198","#268BD2","#6C71C4"];
    const diatonicNotesMap = new Map();

    if (selectedKey !== null && modeDef) {
      modeDef.intervals.forEach((interval, idx) => {
        const scaleNoteIdx = (selectedKey + interval) % 12;
        diatonicNotesMap.set(scaleNoteIdx, idx);
      });
    }

    keys.forEach(key => {
      const midi = Number(key.dataset.midi);
      const noteIdx = (midi - 60) % 12;
      const isBlack = key.classList.contains("is-black");
      const textSpan = key.querySelector(".piano-key-text");
      
      const degreeIdx = diatonicNotesMap.get(noteIdx);

      key.style.background = isBlack ? "#121214" : "#ffffff";
      key.style.border = isBlack ? "1px solid #2c2c2e" : "1px solid #d1d1d6";

      if (degreeIdx !== undefined) {
        key.classList.add("has-note");
        textSpan.style.color = degreeColors[degreeIdx];
        textSpan.style.fontWeight = "800";
      } else {
        key.classList.remove("has-note");
        textSpan.style.color = "transparent";
      }
    });
  }
}

function applyScaleHighlights(){
  document.querySelectorAll(".chord").forEach(b=>{
    b.style.background="";
    b.style.outline="";
    const existingRoman = b.querySelector(".chord-roman");
    if(existingRoman) existingRoman.remove();
  });

  if(selectedMode === "chromatic"){
    if(chromaticHighlightState > 0){
      document.querySelectorAll(".chord").forEach(b=>{
        const br = Number(b.dataset.root);
        const bt = b.dataset.type;
        const bst = b.dataset.seventhType;
        const key = (bt === "7" && bst) ? `${br}-${bt}-${bst}` : `${br}-${bt}`;
        if(chromaticHighlights.has(key)){
          b.style.background = "#D33682";
        }
      });
    }
    highlightActiveChord(new Map());
    updatePianoHighlights();
    return;
  }

  const modeDef = MODES[selectedMode];
  const degreeColors = ["#D33682","#CB4B16","#B58900","#859900","#2AA198","#268BD2","#6C71C4"];
  const romanNumeralsBase = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const colorMap = new Map();
  const romanMap = new Map();

  modeDef.intervals.forEach((interval, idx) => {
    const scaleRoot = (selectedKey + interval) % 12;
    const quality = modeDef.qualities[idx];
    colorMap.set(`${scaleRoot}-${quality}`, degreeColors[idx]);

    let roman = romanNumeralsBase[idx];
    if(quality === "minor") roman = roman.toLowerCase();
    if(quality === "diminished") roman = roman.toLowerCase() + "°";
    romanMap.set(`${scaleRoot}-${quality}`, roman);
  });

  document.querySelectorAll(".chord").forEach(b=>{
    const br = Number(b.dataset.root);
    const bt = b.dataset.type;
    const color = colorMap.get(`${br}-${bt}`);
    const roman = romanMap.get(`${br}-${bt}`);
    if(color){
      b.style.background = color;
    }
    if(roman){
      const romanSpan = document.createElement("span");
      romanSpan.className = "chord-roman";
      romanSpan.textContent = roman;
      b.appendChild(romanSpan);
    }
  });

  highlightActiveChord(colorMap);
  updatePianoHighlights();
}

function highlightActiveChord(colorMap){
  document.querySelectorAll(".chord").forEach(b=>{
    const br = Number(b.dataset.root);
    const bt = b.dataset.type;
    const bst = b.dataset.seventhType;

    const isCurrent = (br === currentRoot && bt === currentType && (bt !== "7" || bst === currentSeventhType));

    if(isCurrent){
      const key = (bt === "7" && bst) ? `${br}-${bt}-${bst}` : `${br}-${bt}`;
      const color = colorMap ? colorMap.get(key) : null;
      const customBg = (selectedMode === "chromatic" && chromaticHighlights.has(key)) ? "#D33682" : null;
      const baseColor = color ? color : (customBg ? customBg : "#1c1c1e");
      b.style.background = lightenHex(baseColor, (color || customBg) ? 45 : 60);
      b.style.outline = "3px solid #fff";
      b.style.outlineOffset = "-2px";
    }
  });
}

function updateInfo(isActive=true){
  document.getElementById("current").textContent=getFullChordName(currentRoot, currentType, currentSeventhType);
  document.getElementById("notes").textContent=notesFor(currentRoot, currentType, currentSeventhType).join(" · ");
  applyScaleHighlights();
  renderHarp();
}

function initAudio(){
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if(!Ctx||audio)return;
  const ctx=new Ctx();
  const master=ctx.createGain();
  const rhythm=ctx.createGain();
  master.gain.value = 1.0;
  const rhythmVolFactor = Number(document.getElementById("rhythmVolume").value)/100;
  rhythm.gain.value = rhythmVolFactor * 2.5;
  rhythm.connect(master);
  master.connect(ctx.destination);
  audio={ctx,master,rhythm};
}
function resumeAudio(){initAudio();if(audio&&audio.ctx.state==="suspended")audio.ctx.resume();}
function midiFreq(m){return 440*Math.pow(2,(m-69)/12)}

function playTone(midi,baseDuration=.5,volume=.13,dest,waveType="square",releaseTime=.25){
  resumeAudio();if(!audio)return null;
  const o=audio.ctx.createOscillator(),g=audio.ctx.createGain(),t=audio.ctx.currentTime;
  o.type=["sine","square","sawtooth","triangle"].includes(waveType) ? waveType : "square";
  o.frequency.value=midiFreq(midi);
  
  g.gain.setValueAtTime(.0001,t);
  g.gain.linearRampToValueAtTime(Math.max(.0001,volume),t+.015);
  
  const totalDuration = baseDuration + Math.max(0.01, releaseTime);
  
  g.gain.setValueAtTime(Math.max(.0001,volume), t + baseDuration);
  g.gain.exponentialRampToValueAtTime(.0001, t + totalDuration);
  
  o.connect(g);g.connect(dest||audio.master);
  o.start(t);o.stop(t+totalDuration+.05);

  recordMidiEvent(0x90, midi, 100);
  setTimeout(() => recordMidiEvent(0x80, midi, 0), Math.round(baseDuration * 1000));

  return {osc:o,gain:g};
}

function stopSustain(){
  if(!audio)return;
  const now=audio.ctx.currentTime;
  sustainNodes.forEach(n=>{
    try{
      n.gain.gain.cancelScheduledValues(now);
      n.gain.gain.setValueAtTime(n.gain.gain.value,now);
      n.gain.gain.exponentialRampToValueAtTime(.0001,now+.1);
      n.osc.stop(now+.15);
    }catch(e){}
  });

  if (isRecording && sustainMidiNotes.length > 0) {
    sustainMidiNotes.forEach(m => recordMidiEvent(0x80, m, 0));
    sustainMidiNotes = [];
  }

  sustainNodes=[];
  sustainActive=false;
}

function getSustainVoices() {
  if(currentType === "diminished") return [0,3,6,12];
  if(currentType === "7") return chordDef("7", currentSeventhType).intervals;
  if(currentType === "minor") return [0,3,7,12];
  return [0,4,7,12];
}

function startSustain(){
  if(chordPicker === "mute") return;
  if(!audio) resumeAudio();
  const intervals=getSustainVoices();
  const base=60+currentRoot;
  const now=audio.ctx.currentTime;
  const activeWave = getChordWave();
  const chordVolFactor = Number(document.getElementById("chordVolume").value)/100;
  const peakVol = 0.16 * chordVolFactor;
  
  if (chordPicker === "legato" && sustainActive && sustainNodes.length === intervals.length) {
    if (isRecording && sustainMidiNotes.length > 0) {
      sustainMidiNotes.forEach(m => recordMidiEvent(0x80, m, 0));
    }
    sustainMidiNotes = intervals.map(i => base + i);
    if (isRecording) {
      sustainMidiNotes.forEach(m => recordMidiEvent(0x90, m, 100));
    }

    intervals.forEach((i, idx) => {
      const freq = midiFreq(base + i);
      sustainNodes[idx].osc.type = activeWave;
      sustainNodes[idx].osc.frequency.cancelScheduledValues(now);
      sustainNodes[idx].osc.frequency.setTargetAtTime(freq, now, 0.05);
    });
    return;
  }
  
  stopSustain();
  sustainMidiNotes = intervals.map(i => base + i);
  if (isRecording) {
    sustainMidiNotes.forEach(m => recordMidiEvent(0x90, m, 100));
  }

  intervals.forEach(i=>{
    const o=audio.ctx.createOscillator(),g=audio.ctx.createGain();
    o.type = activeWave;
    o.frequency.value=midiFreq(base+i);
    g.gain.setValueAtTime(.0001,now);
    g.gain.exponentialRampToValueAtTime(peakVol,now+.05);
    o.connect(g);g.connect(audio.master);
    o.start(now);
    sustainNodes.push({osc:o,gain:g});
  });
  sustainActive=true;
}

function getPreviewIntervals(){
  return chordDef(currentType, currentSeventhType).intervals;
}
function playChordIntervals(intervals){
  if(chordPicker === "mute") return;
  const base=60+currentRoot;
  const activeWave = getChordWave();
  const chordVolFactor = Number(document.getElementById("chordVolume").value)/100;
  const vol = 0.18 * chordVolFactor;
  const release = getChordRelease();

  if(chordPicker==="arpeggio"){
    intervals.forEach((i,n)=>setTimeout(()=>playTone(base+i,.4,vol,null,activeWave,release),n*85));
  }else if(chordPicker==="staccato"){
    intervals.forEach(i=>playTone(base+i,.15,vol,null,activeWave,release));
  }
}

function getHarpIntervals(){
  if(currentType === "7"){
    const ints = chordDef("7", currentSeventhType).intervals;
    return [ints[0], ints[1], ints[3] || ints[2]];
  }
  if(currentType === "minor") return [0,3,7];
  if(currentType === "diminished") return [0,3,6];
  return [0,4,7];
}

function playHarpNote(laneIndex){
  const intervals=getHarpIntervals(),group=Math.floor(laneIndex/3),tone=intervals[laneIndex%3];
  const midi=60+currentRoot+tone+(group*12)+((laneIndex%3===2)?-12:0);
  const activeHarpWave = getHarpWave();
  const harpVolFactor = Number(document.getElementById("harpVolume").value)/100;
  const vol = 0.14 * harpVolFactor;
  const release = getHarpRelease();

  playTone(midi,0.5,vol,null,activeHarpWave,release);
  const lane=document.querySelector(`.harp-lane[data-lane="${laneIndex}"]`);
  if(lane){
    lane.classList.add("played");
    setTimeout(()=>lane.classList.remove("played"),110);
  }
}

function renderHarp(){
  const grid=document.getElementById("harpGrid");
  if(!grid)return;
  grid.innerHTML="";
  for(let i=11;i>=0;i--){
    const lane=document.createElement("div");
    lane.className="harp-lane";
    lane.dataset.lane=i;
    grid.appendChild(lane);
  }
}

function syncHeights(){
  const centerEl = document.getElementById("centerContent");
  const harpSeg = document.getElementById("verticalHarpSegment");
  const chordArea = document.getElementById("chordArea");
  const controlsDropdown = document.getElementById("controlsDropdown");
  const recordDropdown = document.getElementById("recordDropdown");
  if(centerEl && harpSeg){
    harpSeg.style.height = centerEl.offsetHeight + "px";
  }
  if(chordArea){
    if(controlsDropdown) controlsDropdown.style.height = chordArea.offsetHeight + "px";
    if(recordDropdown) recordDropdown.style.height = chordArea.offsetHeight + "px";
  }
}

function updateScaling(){
  const app = document.getElementById("appContainer");
  if(!app) return;
  const baseWidth = 1160;
  const winWidth = window.innerWidth - 20;
  
  if(window.innerWidth < 1180){
    const scale = winWidth / baseWidth;
    app.style.transform = `scale(${scale})`;
    const unscaledHeight = app.scrollHeight;
    const scaledHeight = unscaledHeight * scale;
    const diff = unscaledHeight - scaledHeight;
    app.style.marginBottom = `-${diff}px`;
  } else {
    app.style.transform = "none";
    app.style.marginBottom = "0px";
  }
}

function handlePointerDrag(e){
  const el=document.elementFromPoint(e.clientX,e.clientY);
  if(el){
    const lane=el.closest(".harp-lane");
    if(lane){
      const i=Number(lane.dataset.lane);
      if(lastLane!==i && i>=0 && i<12){
        if(lastLane!==-1){
          const step=i>lastLane?1:-1;
          for(let n=lastLane+step;n!==i;n+=step) playHarpNote(n);
        }
        playHarpNote(i);lastLane=i;
      }
    }
  }
}

const harpGridEl=document.getElementById("harpGrid");
harpGridEl.addEventListener("pointerdown",e=>{e.preventDefault();resumeAudio();harpDragging=true;activePointerId=e.pointerId;harpGridEl.setPointerCapture?.(e.pointerId);handlePointerDrag(e);});
harpGridEl.addEventListener("pointermove",e=>{if(harpDragging && e.pointerId===activePointerId)handlePointerDrag(e);});
function endHarp(){harpDragging=false;activePointerId=null;lastLane=-1;}
document.addEventListener("pointerup",endHarp);document.addEventListener("pointercancel",endHarp);

function kick(){
  if(!audio)return;
  const o=audio.ctx.createOscillator(),g=audio.ctx.createGain(),t=audio.ctx.currentTime;
  o.type="sine";o.frequency.setValueAtTime(120,t);o.frequency.exponentialRampToValueAtTime(45,t+.14);
  g.gain.setValueAtTime(.75,t);g.gain.exponentialRampToValueAtTime(.001,t+.18);
  o.connect(g);g.connect(audio.rhythm);o.start(t);o.stop(t+.2);

  recordMidiEvent(0x99, 36, 100);
  setTimeout(() => recordMidiEvent(0x89, 36, 0), 100);
}

function noise(duration,cutoff,volume){
  if(!audio)return;
  const len=Math.floor(audio.ctx.sampleRate*duration),buffer=audio.ctx.createBuffer(1,len,audio.ctx.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<len;i++)data[i]=Math.random()*2-1;
  const s=audio.ctx.createBufferSource(),f=audio.ctx.createBiquadFilter(),g=audio.ctx.createGain(),t=audio.ctx.currentTime;
  s.buffer=buffer;f.type="highpass";f.frequency.value=cutoff;
  g.gain.setValueAtTime(volume,t);g.gain.exponentialRampToValueAtTime(.001,t+duration);
  s.connect(f);f.connect(g);g.connect(audio.rhythm);s.start(t);

  const midiPercNote = cutoff > 2000 ? 42 : 38;
  recordMidiEvent(0x99, midiPercNote, 80);
  setTimeout(() => recordMidiEvent(0x89, midiPercNote, 0), Math.round(duration * 1000));
}

function rhythmTick(){
  const name=document.getElementById("rhythm").value;
  const pat=PATTERNS[name],step=rhythmStep%pat.len;
  if(pat.k.includes(step))kick();if(pat.s.includes(step))noise(.12,1100,.35);if(pat.h.includes(step))noise(.045,5000,.15);
  rhythmStep++;
}

function schedule(){
  if(!playing)return;
  rhythmTick();
  const name=document.getElementById("rhythm").value,bpm=Number(document.getElementById("tempo").value),sub=PATTERNS[name]?PATTERNS[name].sub:4;
  rhythmTimer=setTimeout(schedule,(60000/bpm)/sub);
}

function start(){resumeAudio();playing=true;rhythmStep=0;document.getElementById("play").textContent="■ Stop";document.getElementById("play").classList.add("playing");schedule();}
function stop(){playing=false;clearTimeout(rhythmTimer);rhythmTimer=null;document.getElementById("play").textContent="▶ Start";document.getElementById("play").classList.remove("playing");}

function render(){
  renderTabs();
  renderChromatic();
  updateInfo(sustainActive || (chordPicker!=="sustain" && chordPicker!=="legato"));
}

const controlsDropdown = document.getElementById("controlsDropdown");
const recordDropdown = document.getElementById("recordDropdown");
const sidebarToggle = document.getElementById("sidebarToggle");
const recordToggle = document.getElementById("recordToggle");
const saveMidiBtn = document.getElementById("saveMidiBtn");
const discardMidiBtn = document.getElementById("discardMidiBtn");

sidebarToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  recordDropdown.classList.add("collapsed");
  controlsDropdown.classList.toggle("collapsed");
});

recordToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  
  if (playing) stop();
  stopSustain();

  if (!isRecording) {
    controlsDropdown.classList.add("collapsed");
    recordDropdown.classList.add("collapsed");
    
    isRecording = true;
    recordStartTime = performance.now();
    recordedEvents = [];
    recordToggle.classList.add("recording");
    recordToggle.title = "Stop Recording";
  } else {
    isRecording = false;
    recordToggle.classList.remove("recording");
    recordToggle.title = "Record MIDI";
    
    if (sustainMidiNotes.length > 0) {
      sustainMidiNotes.forEach(m => recordMidiEvent(0x80, m, 0));
      sustainMidiNotes = [];
    }
    
    if (recordedEvents.length > 0) {
      recordDropdown.classList.remove("collapsed");
    }
  }
});

saveMidiBtn.addEventListener("click", () => {
  const blob = buildMidiBlob(recordedEvents);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "omnichord_recording.mid";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  recordedEvents = [];
  recordDropdown.classList.add("collapsed");
});

discardMidiBtn.addEventListener("click", () => {
  recordedEvents = [];
  recordDropdown.classList.add("collapsed");
});

document.addEventListener("pointerdown", (e) => {
  if (!controlsDropdown.classList.contains("collapsed")) {
    if (!controlsDropdown.contains(e.target) && !sidebarToggle.contains(e.target)) {
      controlsDropdown.classList.add("collapsed");
    }
  }
  if (!recordDropdown.classList.contains("collapsed")) {
    if (!recordDropdown.contains(e.target) && !recordToggle.contains(e.target)) {
      recordDropdown.classList.add("collapsed");
    }
  }
});

document.getElementById("seventhType").addEventListener("change", e => {
  stopSustain();
  selectedSeventhType = e.target.value;
  render();
});

document.getElementById("chordWave").addEventListener("change", () => {
  stopSustain();
});

document.getElementById("chordPicker").addEventListener("change", e => {
  chordPicker = e.target.value;
  stopSustain();
  updateInfo(false);
});
document.getElementById("tempo").addEventListener("input",e=>document.getElementById("tempoValue").textContent=e.target.value);
document.getElementById("rhythmVolume").addEventListener("input",e=>{
  const val = e.target.value;
  document.getElementById("rhythmVolumeValue").textContent = val + "%";
  resumeAudio();
  if(audio) audio.rhythm.gain.value = (Number(val)/100) * 2.5;
});
document.getElementById("chordVolume").addEventListener("input",e=>document.getElementById("chordVolumeValue").textContent=e.target.value+"%");
document.getElementById("harpVolume").addEventListener("input",e=>document.getElementById("harpVolumeValue").textContent=e.target.value+"%");
document.getElementById("pianoVolume").addEventListener("input",e=>document.getElementById("pianoVolumeValue").textContent=e.target.value+"%");

document.getElementById("chordRelease").addEventListener("input",e=>{
  const val = Number(e.target.value);
  const min = 0, max = 0.8;
  const pct = Math.round(((val - min) / (max - min)) * 100);
  document.getElementById("chordReleaseValue").textContent = pct + "%";
});

document.getElementById("harpRelease").addEventListener("input",e=>{
  const val = Number(e.target.value);
  const min = 0.1, max = 1.5;
  const pct = Math.round(((val - min) / (max - min)) * 100);
  document.getElementById("harpReleaseValue").textContent = pct + "%";
});

document.getElementById("pianoRelease").addEventListener("input",e=>{
  const val = Number(e.target.value);
  const min = 0.1, max = 1.5;
  const pct = Math.round(((val - min) / (max - min)) * 100);
  document.getElementById("pianoReleaseValue").textContent = pct + "%";
});

document.getElementById("play").addEventListener("pointerdown",()=>{if(playing)stop();else start();});
document.getElementById("rhythm").addEventListener("change",()=>{if(playing){stop();start();}});

window.addEventListener("resize", () => {
  updateScaling();
  syncHeights();
});

document.addEventListener("keydown",e=>{
  if(e.repeat||["INPUT","SELECT","TEXTAREA"].includes(e.target.tagName))return;
  if(e.code in HARP_KEYS){e.preventDefault();playHarpNote(HARP_KEYS[e.code]);return;}
});

initPiano();
render();
window.addEventListener("load", ()=>{
  updateScaling();
  syncHeights();
});
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('Service Worker registered!'))
        .catch(err => console.log('Registration failed: ', err));
    });
  }