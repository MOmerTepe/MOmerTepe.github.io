// Small, original line drawings shared by the pawn picker and accessible board.
const paths = {
  ferry: '<path d="M4 16h24l-4 9H8zM9 16V9h14v7M12 9V5h8v4M3 28q4-4 8 0t8 0 8 0"/><path d="M12 12h2m4 0h2"/>',
  cat: '<path d="M9 27V15L7 6l8 5h3l7-5-1 11v10zM10 20q6 4 12 0M12 15h1m6 0h1M24 25q7 0 4-9"/>',
  tower: '<path d="M8 28h16M10 28V13h12v15M8 13l8-10 8 10zM8 17h16M14 28v-7h4v7M13 14v2m6-2v2"/>',
  tulip: '<path d="M16 29V17M16 23Q5 23 5 16q9 0 11 7M16 26q11-1 11-8-8 0-11 8M16 18C7 18 7 6 7 6l6 5 3-8 3 8 6-5s0 12-9 12z"/>',
  tea: '<path d="M9 6h14q-6 8-1 19H10q5-11-1-19zM6 28h20M10 17h12M12 3h8"/>',
  tram: '<rect x="7" y="7" width="18" height="18" rx="3"/><path d="M10 7l3-4h7l3 4M7 17h18M16 7v10M10 25l-3 4m15-4 3 4M10 22h2m8 0h2"/>',
  house: '<path d="M4 15L16 5l12 10M7 13v15h18V13M13 28V18h6v10"/>',
  hotel: '<path d="M6 29V4h20v25M3 29h26M13 29v-7h6v7M11 9h2m6 0h2M11 15h2m6 0h2"/>',
  dice: '<rect x="5" y="5" width="22" height="22" rx="4"/><circle cx="11" cy="11" r="1"/><circle cx="21" cy="21" r="1"/><circle cx="16" cy="16" r="1"/>',
};
export function pawnIcon(id='ferry',className='pawn-icon') {
  return `<svg class="${className}" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id]||paths.ferry}</svg>`;
}
export function buildingIcons(count) {
  return count===5?pawnIcon('hotel','building-icon hotel-icon'):Array.from({length:count},()=>pawnIcon('house','building-icon')).join('');
}

export class GameEffects {
  constructor({reducedMotion=false,sound=false}={}){this.reducedMotion=reducedMotion;this.sound=sound;this.context=null;this.running=[];}
  configure(options){Object.assign(this,options);}
  unlock(){if(!this.sound)return;try{this.context??=new (window.AudioContext||window.webkitAudioContext)();if(this.context.state==='suspended')this.context.resume();}catch{}}
  play(kind){
    if(!this.sound||!this.context||this.context.state!=='running')return;
    const notes=kind==='ROLL'?[160,220,130,260]:kind==='BUILD'?[330,440,660]:kind==='finished'?[262,330,392,523]:kind==='BUY'||kind==='BID'?[440,660]:[392];
    notes.forEach((f,i)=>{const time=this.context.currentTime+i*.065,o=this.context.createOscillator(),g=this.context.createGain();o.type=kind==='ROLL'?'triangle':'sine';o.frequency.setValueAtTime(f,time);g.gain.setValueAtTime(0,time);g.gain.linearRampToValueAtTime(.045,time+.008);g.gain.exponentialRampToValueAtTime(.001,time+.13);o.connect(g);g.connect(this.context.destination);o.start(time);o.stop(time+.15);});
  }
  stop(){this.running.forEach(a=>a.cancel?.());this.running=[];document.querySelectorAll('.moving-pawn,.cash-float,.confetti-piece').forEach(e=>e.remove());document.querySelectorAll('.token-travelling').forEach(e=>e.classList.remove('token-travelling'));}
  transition(previous,next,{view='3d',tokenMarkup}={}){
    if(!previous||!next||next.kind==='lobby'||previous.kind==='lobby'||previous.revision===next.revision)return;
    this.play(next.phase==='finished'?'finished':next.lastAction?.type);
    if(this.reducedMotion)return;
    this.stop();
    for(const p of next.players){
      const delta=p.cash-(previous.players.find(x=>x.id===p.id)?.cash??p.cash);
      const row=document.querySelector(`[data-player-row="${CSS.escape(p.id)}"]`);
      if(delta&&row){const el=document.createElement('span');el.className=`cash-float ${delta>0?'gain':'loss'}`;el.textContent=(delta>0?'+':'−')+'₺'+Math.abs(delta).toLocaleString('en-US');row.append(el);const a=el.animate([{opacity:0,transform:'translateY(9px)'},{opacity:1,transform:'translateY(0)',offset:.15},{opacity:0,transform:'translateY(-25px)'}],{duration:1700,easing:'ease-out'});a.onfinish=()=>el.remove();this.running.push(a);}
    }
    if(view==='2d'&&next.lastMove?.path.length){
      const move=next.lastMove,p=next.players.find(x=>x.id===move.playerId),board=document.querySelector('#board'),rect=board.getBoundingClientRect();
      const el=document.createElement('span');el.className='moving-pawn';el.dataset.player=p.id;el.innerHTML=tokenMarkup(p);board.append(el);
      const destination=board.querySelector(`.token[data-player="${CSS.escape(p.id)}"]`);destination?.classList.add('token-travelling');
      const frames=[move.from,...move.path].map(i=>{const cell=board.querySelector(`[data-space="${i}"]`).getBoundingClientRect();return{transform:`translate(${cell.x-rect.x+cell.width/2-13}px,${cell.y-rect.y+cell.height/2-13}px)`};});
      const a=el.animate(frames,{duration:Math.max(150,move.path.length*70),delay:next.lastAction?.type==='ROLL'?650:0,fill:'both'});a.onfinish=()=>{el.remove();board.querySelectorAll(`.token[data-player="${CSS.escape(p.id)}"]`).forEach(t=>t.classList.remove('token-travelling'));};this.running.push(a);
    }
    if(next.phase==='finished'&&previous.phase!=='finished'){
      const host=document.querySelector('#celebration');for(let i=0;i<38;i++){const el=document.createElement('i');el.className='confetti-piece';el.style.background=['#a75542','#447b76','#d6b866','#7d6aa0'][i%4];el.style.left=`${(i*37)%100}%`;host.append(el);const a=el.animate([{transform:`translateY(-20px) rotate(${i*13}deg)`,opacity:1},{transform:`translateY(500px) rotate(${i*61}deg)`,opacity:0}],{duration:1600+(i%7)*110,delay:(i%9)*70});a.onfinish=()=>el.remove();this.running.push(a);}
    }
  }
}
