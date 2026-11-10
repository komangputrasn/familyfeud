// Twinkling background stars (back canvas) and sparkle bursts (front canvas).

function makeSprite(rgb) {
  const size = 64;
  const mid = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');

  const glow = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
  glow.addColorStop(0, `rgba(${rgb}, 0.85)`);
  glow.addColorStop(0.2, `rgba(${rgb}, 0.3)`);
  glow.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);

  // Four-point star with edges pinched towards the centre.
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(mid, 0);
  g.quadraticCurveTo(mid, mid, size, mid);
  g.quadraticCurveTo(mid, mid, mid, size);
  g.quadraticCurveTo(mid, mid, 0, mid);
  g.quadraticCurveTo(mid, mid, mid, 0);
  g.fill();
  return canvas;
}

export class Sparkles {
  constructor(back, front) {
    this.back = back;
    this.front = front;
    this.bg = back.getContext('2d');
    this.fg = front.getContext('2d');
    this.sprites = {
      white: makeSprite('255, 255, 255'),
      blue: makeSprite('170, 220, 255'),
      gold: makeSprite('255, 215, 110'),
    };
    this.stars = [];
    this.particles = [];
    this.frontDirty = false;
    this.last = performance.now();
    this.resize();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    this.ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    for (const canvas of [this.back, this.front]) {
      canvas.width = Math.round(this.w * this.ratio);
      canvas.height = Math.round(this.h * this.ratio);
    }
    this.bg.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    this.fg.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);

    const count = Math.round(Math.min(130, Math.max(50, (this.w * this.h) / 17000)));
    const unit = Math.max(0.6, this.h / 1080);
    this.stars = Array.from({ length: count }, () => {
      const big = Math.random() < 0.14;
      return {
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        size: (big ? 30 + Math.random() * 26 : 7 + Math.random() * 16) * unit,
        speed: 0.5 + Math.random() * 1.7,
        phase: Math.random() * Math.PI * 2,
        rise: (3 + Math.random() * 9) * unit,
        sprite: Math.random() < 0.6 ? 'white' : Math.random() < 0.75 ? 'blue' : 'gold',
      };
    });
  }

  // x, y in viewport pixels.
  burst(x, y, count, { gold = false, power = 1, spreadX = 0, spreadY = 0 } = {}) {
    const unit = Math.max(0.6, this.h / 1080);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (120 + Math.random() * 620) * power * unit;
      const life = 0.6 + Math.random() * 1.1;
      this.particles.push({
        x: x + (Math.random() - 0.5) * spreadX,
        y: y + (Math.random() - 0.5) * spreadY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 120 * unit,
        life,
        age: 0,
        size: (10 + Math.random() * 34) * unit,
        flicker: 8 + Math.random() * 18,
        sprite: gold ? (Math.random() < 0.7 ? 'gold' : 'white') : Math.random() < 0.55 ? 'white' : 'blue',
      });
    }
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const time = now / 1000;

    const bg = this.bg;
    bg.clearRect(0, 0, this.w, this.h);
    bg.globalCompositeOperation = 'lighter';
    for (const star of this.stars) {
      star.y -= star.rise * dt;
      if (star.y < -star.size) {
        star.y = this.h + star.size;
        star.x = Math.random() * this.w;
      }
      const wave = Math.max(0, Math.sin(time * star.speed + star.phase));
      const alpha = wave * wave * wave;
      if (alpha < 0.02) continue;
      const size = star.size * (0.6 + 0.4 * alpha);
      bg.globalAlpha = alpha * 0.95;
      bg.drawImage(this.sprites[star.sprite], star.x - size / 2, star.y - size / 2, size, size);
    }
    bg.globalAlpha = 1;

    if (this.particles.length || this.frontDirty) {
      const fg = this.fg;
      fg.clearRect(0, 0, this.w, this.h);
      fg.globalCompositeOperation = 'lighter';
      const gravity = 420 * Math.max(0.6, this.h / 1080);
      this.particles = this.particles.filter((p) => {
        p.age += dt;
        if (p.age >= p.life) return false;
        p.vx *= 1 - 1.6 * dt;
        p.vy = p.vy * (1 - 1.6 * dt) + gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const left = 1 - p.age / p.life;
        const size = p.size * (0.35 + 0.65 * left);
        fg.globalAlpha = left * (0.55 + 0.45 * Math.sin(p.age * p.flicker));
        fg.drawImage(this.sprites[p.sprite], p.x - size / 2, p.y - size / 2, size, size);
        return true;
      });
      fg.globalAlpha = 1;
      this.frontDirty = this.particles.length > 0;
    }

    requestAnimationFrame((t) => this.frame(t));
  }
}
