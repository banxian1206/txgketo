/* A fixed 2.5D character with articulated SVG joints. No generated frame swaps. */
function createPandaRig(host){
 host.innerHTML=`<svg class="panda-visual" viewBox="0 0 240 240" role="img" aria-label="尺寸固定、会眨眼吃竹子和招手的小熊猫">
 <defs>
  <radialGradient id="pr-white" cx="38%" cy="28%" r="78%"><stop stop-color="#fffef9"/><stop offset=".64" stop-color="#f3eee3"/><stop offset="1" stop-color="#d4c8b6"/></radialGradient>
  <radialGradient id="pr-dark" cx="32%" cy="20%" r="85%"><stop stop-color="#535054"/><stop offset=".55" stop-color="#2c2b30"/><stop offset="1" stop-color="#17171c"/></radialGradient>
  <radialGradient id="pr-pad" cx="35%" cy="25%" r="80%"><stop stop-color="#a58b79"/><stop offset="1" stop-color="#59473e"/></radialGradient>
  <radialGradient id="pr-iris"><stop stop-color="#956e43"/><stop offset=".7" stop-color="#5e412b"/><stop offset="1" stop-color="#211b19"/></radialGradient>
  <linearGradient id="pr-bamboo" x2="1" y2="0"><stop stop-color="#537c2d"/><stop offset=".45" stop-color="#a3c55a"/><stop offset="1" stop-color="#517528"/></linearGradient>
  <filter id="pr-soft" x="-25%" y="-25%" width="150%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#392d26" flood-opacity=".13"/></filter>
 </defs>
 <ellipse cx="121" cy="218" rx="62" ry="5" fill="#637184" opacity=".09"/>
 <g data-rig="body" filter="url(#pr-soft)">
 <ellipse cx="120" cy="162" rx="58" ry="51" fill="url(#pr-dark)"/>
 <ellipse cx="121" cy="175" rx="38" ry="40" fill="url(#pr-white)"/>
 <path d="M99 165Q120 155 141 165" fill="none" stroke="#fffef7" stroke-opacity=".5" stroke-width="3"/>
 <g><ellipse cx="77" cy="200" rx="29" ry="25" transform="rotate(-20 77 200)" fill="url(#pr-dark)"/><ellipse cx="77" cy="205" rx="13" ry="11" fill="url(#pr-pad)"/><ellipse cx="62" cy="190" rx="5" ry="6" fill="url(#pr-pad)"/><ellipse cx="74" cy="185" rx="5" ry="6" fill="url(#pr-pad)"/><ellipse cx="86" cy="188" rx="5" ry="6" fill="url(#pr-pad)"/></g>
 <g><ellipse cx="164" cy="200" rx="29" ry="25" transform="rotate(20 164 200)" fill="url(#pr-dark)"/><ellipse cx="164" cy="205" rx="13" ry="11" fill="url(#pr-pad)"/><ellipse cx="152" cy="188" rx="5" ry="6" fill="url(#pr-pad)"/><ellipse cx="164" cy="185" rx="5" ry="6" fill="url(#pr-pad)"/><ellipse cx="177" cy="190" rx="5" ry="6" fill="url(#pr-pad)"/></g>
 </g>
 <g data-rig="head" filter="url(#pr-soft)">
 <circle cx="66" cy="44" r="23" fill="url(#pr-dark)"/><circle cx="175" cy="44" r="23" fill="url(#pr-dark)"/>
 <ellipse cx="63" cy="39" rx="10" ry="13" fill="#797477" opacity=".18"/><ellipse cx="172" cy="39" rx="10" ry="13" fill="#797477" opacity=".18"/>
 <ellipse cx="120" cy="94" rx="70" ry="61" fill="url(#pr-white)"/>
 <ellipse cx="92" cy="98" rx="21" ry="28" transform="rotate(27 92 98)" fill="url(#pr-dark)"/>
 <ellipse cx="150" cy="98" rx="21" ry="28" transform="rotate(-27 150 98)" fill="url(#pr-dark)"/>
 <g data-eye="left" transform="translate(96 98)"><g data-rig="eye-left"><ellipse rx="11" ry="14" fill="#fffef6"/><ellipse cx="1" cy="1" rx="8.8" ry="11.8" fill="url(#pr-iris)"/><ellipse cx="1" cy="2" rx="5.7" ry="8.7" fill="#19171a"/><ellipse cx="-2" cy="-4" rx="3.1" ry="3.5" fill="white"/><circle cx="4" cy="5" r="1.3" fill="#fff" opacity=".6"/></g></g>
 <g data-eye="right" transform="translate(145 98)"><g data-rig="eye-right"><ellipse rx="11" ry="14" fill="#fffef6"/><ellipse cx="-1" cy="1" rx="8.8" ry="11.8" fill="url(#pr-iris)"/><ellipse cx="-1" cy="2" rx="5.7" ry="8.7" fill="#19171a"/><ellipse cx="-4" cy="-4" rx="3.1" ry="3.5" fill="white"/><circle cx="2" cy="5" r="1.3" fill="#fff" opacity=".6"/></g></g>
 <path d="M84 65Q93 60 102 65M139 65Q148 60 157 65" stroke="#68605b" stroke-width="3" stroke-linecap="round" fill="none"/>
 <ellipse cx="120" cy="122" rx="29" ry="18" fill="#fffaf0" opacity=".62"/>
 <path d="M109 109Q120 104 131 109Q132 114 121 119Q116 118 109 113Z" fill="url(#pr-dark)"/>
 <ellipse cx="116" cy="109" rx="4" ry="1.3" fill="#ffffff" opacity=".21"/>
 <path d="M120 118L120 122" stroke="#51433d" stroke-width="1.8" stroke-linecap="round"/>
 <path data-rig="mouth" d="M108 123Q120 130 132 123Q120 130 108 123Z" fill="#5e3833" stroke="#5b443a" stroke-width="1.5" stroke-linejoin="round"/>
 <ellipse data-rig="tongue" cx="120" cy="130" rx="6" ry="2" fill="#df9794" opacity="0"/>
 <ellipse cx="76" cy="117" rx="9" ry="4" fill="#e8b4a5" opacity=".18"/><ellipse cx="165" cy="117" rx="9" ry="4" fill="#e8b4a5" opacity=".18"/>
 </g>
 <g data-rig="eat-arm">
 <path d="M72 148Q68 172 93 179" fill="none" stroke="url(#pr-dark)" stroke-width="27" stroke-linecap="round"/>
 <g><path d="M109 199L94 134" stroke="url(#pr-bamboo)" stroke-width="7" stroke-linecap="round"/><path d="M105 182L111 181M101 164L107 163M97 147L103 146" stroke="#d2df8c" stroke-width="2"/>
 <path d="M97 151Q76 151 77 133Q95 137 97 151M100 162Q120 156 122 142Q105 145 100 162M96 145Q88 127 93 119Q108 132 96 145" fill="#87ad42"/><path d="M77 133L97 151L93 120M100 162L122 142" fill="none" stroke="#bbd477" stroke-width="1"/></g>
 <ellipse cx="92" cy="171" rx="17" ry="13" transform="rotate(-15 92 171)" fill="url(#pr-dark)"/>
 <path d="M100 176L103 173M102 180L105 177" stroke="#c2b29c" stroke-width="2" stroke-linecap="round"/>
 </g>
 <g data-rig="wave-arm"><path d="M165 149Q176 163 164 182" fill="none" stroke="url(#pr-dark)" stroke-width="26" stroke-linecap="round"/><ellipse cx="164" cy="178" rx="15" ry="17" fill="url(#pr-dark)"/><g data-rig="hand-pads" opacity="0"><ellipse cx="164" cy="181" rx="7" ry="6" fill="url(#pr-pad)"/><circle cx="157" cy="170" r="3" fill="url(#pr-pad)"/><circle cx="164" cy="167" r="3" fill="url(#pr-pad)"/><circle cx="171" cy="170" r="3" fill="url(#pr-pad)"/></g></g>
 </svg>`;
 const node=name=>host.querySelector('[data-rig="'+name+'"]');
 const left=node('eye-left'),right=node('eye-right'),mouth=node('mouth'),tongue=node('tongue'),eat=node('eat-arm'),wave=node('wave-arm'),pads=node('hand-pads');
 const ease=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x)};
 const envelope=(t,duration)=>ease(t/.55)*ease((duration-t)/.55);
 let action='idle',started=performance.now(),duration=0,lastBlink=started,nextBlink=started+2400;
 function play(name,seconds=3.4){action=name;started=performance.now();duration=seconds*1000;host.dataset.action=name}
 function tick(now){
  const elapsed=Math.max(0,now-started)/1000;
  if(action!=='idle'&&elapsed>=duration/1000){action='idle';host.dataset.action='idle'}
  if(now>=nextBlink){lastBlink=now;nextBlink=now+3000+Math.random()*2400}
  const bt=(now-lastBlink)/1000,blink=bt>=0&&bt<.32?Math.pow(Math.sin(bt/.32*Math.PI),2):0;
  const active=action==='idle'?0:envelope(elapsed,duration/1000);
  const smile=action==='wave'?active*.25:action==='eat'?active*.1:0;
  const eyeScale=Math.max(.045,1-blink-smile);
  left.setAttribute('transform','scale(1 '+eyeScale.toFixed(4)+')');right.setAttribute('transform','scale(1 '+eyeScale.toFixed(4)+')');
  const lift=action==='eat'?active:0;
  eat.setAttribute('transform','translate('+(lift*17).toFixed(3)+' '+(-lift*14).toFixed(3)+')');
  const angle=action==='wave'?active*(-125+Math.sin(elapsed*9)*9):0;
  wave.setAttribute('transform','rotate('+angle.toFixed(3)+' 165 149)');pads.setAttribute('opacity',String(action==='wave'?active:0));
  const open=action==='talk'?active*(3+Math.sin(elapsed*13)*2):action==='eat'?active*(1.7+Math.sin(elapsed*12)*1.2):action==='wave'?active*4:0;
  const base=128,depth=base+open*2;
  mouth.setAttribute('d',`M108 123Q120 ${base} 132 123Q120 ${depth} 108 123Z`);
  tongue.setAttribute('cy',String(125+open*.75));tongue.setAttribute('opacity',String(Math.min(.9,open/5)));
 }
 tick(started);return {play,tick};
}
