/**
 * Just-for-fun achievements. They pop up as you earn them and last for this
 * browser session only (nothing is saved), so they carry across races and a
 * whole Grand Prix but start fresh on reload.
 */

export const ACHIEVEMENTS = {
  // Race
  cleanLap: { icon: '🧼', name: 'Clean Lap', desc: 'Complete a lap without hitting the wall!' },
  stunt: { icon: '🤸', name: 'Stuntman', desc: 'Land a trick' },
  showboat: { icon: '🎪', name: 'Showboat', desc: 'Land a 3-trick combo' },
  flyer: { icon: '🦅', name: 'Frequent Flyer', desc: 'Stay airborne for 1.5 seconds in one jump' },
  driftKing: { icon: '🔥', name: 'Drift King', desc: 'Hold a drift for 3 seconds' },
  slipstream: { icon: '💨', name: 'Slipstreamer', desc: 'Draft behind a rival for 3 seconds' },
  fullSend: { icon: '🚀', name: 'Full Send', desc: 'Burn a full tank of nitro in one go' },
  warp: { icon: '⚡', name: 'Warp Speed', desc: 'Hit 230 km/h' },
  ceiling: { icon: '🙃', name: 'Ceiling Walker', desc: 'Drive upside down for a whole second' },
  detour: { icon: '🗺️', name: 'Road Less Travelled', desc: 'Take an alternate route' },
  locksmith: { icon: '🔑', name: 'Locksmith', desc: 'Grab a golden key' },
  wipeout: { icon: '💥', name: 'Wipeout', desc: 'Crash spectacularly' },
  demolition: { icon: '🧱', name: 'Demolition Derby', desc: 'Get wrecked by hitting walls (Wall damage on)' },
  wrongWay: { icon: '↩️', name: 'Wrong Way!', desc: 'Drive backwards for 2 seconds' },
  overtaker: { icon: '🏎️', name: 'Overtaker', desc: 'Gain 3 places in one lap' },
  podium: { icon: '🥉', name: 'Podium', desc: 'Finish a race in the top 3' },
  winner: { icon: '🏆', name: 'Winner', desc: 'Win a race' },
  flawless: { icon: '💎', name: 'Flawless Victory', desc: 'Win a race without touching a wall' },
  photo: { icon: '📸', name: 'Photo Finish', desc: 'Finish within 0.3 seconds of another car' },
  crowd: { icon: '🤯', name: 'Crowd Pleaser', desc: 'Start a race against 20 AI cars' },
  kaiju: { icon: '🐘', name: 'Kaiju', desc: 'Race with giant cars' },
  pocket: { icon: '🐭', name: 'Pocket Rocket', desc: 'Race with tiny cars' },
  marathon: { icon: '🥵', name: 'Marathon', desc: 'Finish a 20-lap race' },
  gpDone: { icon: '🏁', name: 'Tour de Force', desc: 'Finish a Grand Prix' },
  gpChamp: { icon: '👑', name: 'Grand Champion', desc: 'Win a Grand Prix' },
  // Battle
  firstBlood: { icon: '🩸', name: 'First Blood', desc: 'Blast a rival' },
  double: { icon: '✌️', name: 'Double Trouble', desc: 'Blast two rivals within 4 seconds' },
  rocketSci: { icon: '🎯', name: 'Rocket Science', desc: 'Get a kill with a rocket' },
  rampage: { icon: '😈', name: 'Rampage', desc: 'Blast 5 rivals without getting wrecked' },
  driftKill: { icon: '🌪️', name: 'Drift & Destroy', desc: 'Get a kill while drifting' },
  bounce: { icon: '🦘', name: 'Bounce House', desc: 'Launch off a jump pad' },
};

const earned = new Set(); // this session only

let box = null;
const queue = [];
let showing = false;

function showNext() {
  if (showing || !queue.length) return;
  showing = true;
  const a = ACHIEVEMENTS[queue.shift()];
  if (!box) {
    box = document.createElement('div');
    box.id = 'achievement';
    document.body.appendChild(box);
  }
  box.innerHTML = `<span class="ic">${a.icon}</span><div><small>ACHIEVEMENT UNLOCKED · ${earned.size}/${Object.keys(ACHIEVEMENTS).length}</small><b>${a.name}</b><p>${a.desc}</p></div>`;
  box.classList.remove('on');
  void box.offsetWidth; // restart the slide-in
  box.classList.add('on');
  setTimeout(() => {
    box.classList.remove('on');
    setTimeout(() => {
      showing = false;
      showNext();
    }, 400);
  }, 3200);
}

/** Award an achievement (once per session). Returns true if it's new. */
export function unlock(id, sfx) {
  if (!ACHIEVEMENTS[id] || earned.has(id)) return false;
  earned.add(id);
  queue.push(id);
  sfx?.play('pickup', 0.8);
  showNext();
  return true;
}

export function earnedCount() {
  return [earned.size, Object.keys(ACHIEVEMENTS).length];
}

/** Earned achievements as a small HTML list (for results screens). */
export function earnedHTML() {
  if (!earned.size) return '';
  const [n, of] = earnedCount();
  return `<div class="achList"><b>Achievements ${n}/${of}</b>${[...earned].map((id) => `<span title="${ACHIEVEMENTS[id].desc}">${ACHIEVEMENTS[id].icon} ${ACHIEVEMENTS[id].name}</span>`).join('')}</div>`;
}
