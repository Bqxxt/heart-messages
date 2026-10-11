 // ================= Setup =================
      const canvas = document.getElementById("canvas");
      const ctx = canvas.getContext("2d");
      let width, height, centerX, centerY;

      // ================= Mobile-responsive heart sizing =================
      // Hearts are scaled up only on small/mobile screens. Tweak these
      // values to fine-tune the effect without touching any drawing logic.
      const HEART_SIZE_CONFIG = {
        mobileBreakpoint: 600, // viewport width (px) at/below which mobile scaling applies
        particleScale: 1.6, // multiplier for individual ambient floating heart sizes on mobile
        formationScale: 1.6, // TARGET multiplier for the overall click-burst heart spread on mobile
        formationMaxWidthRatio: 0.92, // safety cap: the fully-formed heart's width won't exceed this
        // fraction of the smaller viewport dimension, so it can never overflow the screen
        messageFontScale: 1.15, // multiplier for the romantic message font size on mobile
      };

      // ================= Romantic messages =================
      const ROMANTIC_MESSAGES = [
        "I Love You",
        "I Miss You",
        "You're My Everything",
        "Forever Yours",
        "Thinking of You",
        "You Make Me Smile",
        "My Love",
        "Always With You",
        "You're Special",
        "Love You Always",
        "I Dreamed About You",
      ];

      // Midpoint of the per-particle curve-scale range used below in HeartParticle
      // (Math.random() * 3 + 7) — used to translate a desired pixel width back
      // into a "formationScale" multiplier.
      const AVG_HEART_CURVE_SCALE = 8.5;

      // Tunable counts/thresholds pulled out as named constants so their
      // purpose is clear at a glance instead of being bare numbers below.
      const PARTICLES_PER_HEART_BURST = 130; // how many particles form one clicked heart
      const AMBIENT_HEART_COUNT = 55; // background hearts drifting upward at all times
      const MAX_HEART_PARTICLES = 900; // hard cap so old particles get trimmed for performance
      const TRAIL_THROTTLE_MS = 60; // minimum gap between mouse-trail hearts

      let mobileParticleScale = 1;
      let mobileFormationScale = 1;
      let mobileMessageFontScale = 1;

      // Recalculates the mobile scale factors for the current viewport.
      // Called on load and on every resize.
      function updateResponsiveScaling() {
        const isMobileView = window.innerWidth <= HEART_SIZE_CONFIG.mobileBreakpoint;

        // Ambient floating background hearts (unrelated to the click-formed heart)
        mobileParticleScale = isMobileView ? HEART_SIZE_CONFIG.particleScale : 2;
        mobileMessageFontScale = isMobileView
          ? HEART_SIZE_CONFIG.messageFontScale
          : 2;

        if (isMobileView) {
          // Grow the *formation* (the overall heart the burst particles settle
          // into) toward the configured target, but never past a size that
          // would crowd or overflow the edges of the current viewport.
          const viewportGuard =
            Math.min(window.innerWidth, window.innerHeight) *
            HEART_SIZE_CONFIG.formationMaxWidthRatio;
          const maxSafeFormationScale =
            viewportGuard / (32 * AVG_HEART_CURVE_SCALE);
          mobileFormationScale = Math.min(
            HEART_SIZE_CONFIG.formationScale,
            maxSafeFormationScale,
          );
        } else {
          mobileFormationScale = 1.5;
        }
      }

      // Syncs the canvas size and center point to the viewport, then
      // recalculates mobile scaling. Runs once on load and on every resize.
      function handleResize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        centerX = width / 2;
        centerY = height / 2;
        updateResponsiveScaling();
      }
      handleResize();
      window.addEventListener("resize", handleResize);

      // ================= Heart curve math =================
      // Classic parametric heart-curve equation. Returns the {x, y} point at
      // angle t, offset to (originX, originY) and scaled by curveScale.
      function getPointOnHeartCurve(t, originX, originY, curveScale) {
        const x = 16 * Math.pow(Math.sin(t), 3);
        const y =
          13 * Math.cos(t) -
          5 * Math.cos(2 * t) -
          2 * Math.cos(3 * t) -
          Math.cos(4 * t);
        return { x: originX + x * curveScale, y: originY - y * curveScale };
      }

      // Draws one filled heart using the curve above. Shared by every
      // particle type below.
      function drawFilledHeart(x, y, size, color, alpha, rotation = 0) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.scale(size / 16, size / 16);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        for (let t = 0; t <= Math.PI * 2 + 0.1; t += 0.15) {
          const p = getPointOnHeartCurve(t, 0, 0, 1);
          if (t === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // ================= Palette =================
      const BLUE_SHADES = [
        "#3b82f6",
        "#60a5fa",
        "#93c5fd",
        "#2563eb",
        "#bfdbfe",
        "#1d4ed8",
      ];
      const WARM_ACCENTS = ["#c4b5fd", "#a5b4fc", "#f0abfc"]; // soft lavender/pink hints for warmth

      // Returns a random particle color.
      function getRandomHeartColor() {
        // mostly blue, occasional soft warm accent for romantic sparkle
        if (Math.random() < 0.12)
          return WARM_ACCENTS[Math.floor(Math.random() * WARM_ACCENTS.length)];
        return BLUE_SHADES[Math.floor(Math.random() * BLUE_SHADES.length)];
      }

      let lastMessageIndex = -1;
      // Returns a random message, guaranteed not to repeat the previous one.
      function getRandomRomanticMessage() {
        if (ROMANTIC_MESSAGES.length === 1) return ROMANTIC_MESSAGES[0];
        let idx;
        do {
          idx = Math.floor(Math.random() * ROMANTIC_MESSAGES.length);
        } while (idx === lastMessageIndex);
        lastMessageIndex = idx;
        return ROMANTIC_MESSAGES[idx];
      }

      // A short-lived label that fades in/out roughly in sync with a heart
      // burst's lifespan, centered inside the formed heart shape.
      class HeartMessage {
        constructor(x, y) {
          this.x = x;
          this.y = y;
          this.text = getRandomRomanticMessage();
          this.life = 0;
          // Timing below is in animation frames (~60fps, since it's driven by
          // requestAnimationFrame): 30 frames ≈ 0.5s.
          this.delayEnd = 30; // 0.5s pause before the message starts appearing
          this.fadeInEnd = this.delayEnd + 35; // fade-in duration unchanged (35 frames)
          this.holdEnd = this.fadeInEnd + 95; // hold duration unchanged (95 frames)
          this.fadeOutEnd = this.holdEnd + 10; // fade-out shortened by 0.5s (was 40 frames, now 10)
          this.maxLife = this.fadeOutEnd;
          this.alpha = 0;
        }

        update() {
          this.life++;
          if (this.life <= this.delayEnd) {
            this.alpha = 0;
          } else if (this.life <= this.fadeInEnd) {
            this.alpha =
              (this.life - this.delayEnd) / (this.fadeInEnd - this.delayEnd);
          } else if (this.life <= this.holdEnd) {
            this.alpha = 1;
          } else if (this.life <= this.fadeOutEnd) {
            this.alpha = Math.max(
              0,
              1 - (this.life - this.holdEnd) / (this.fadeOutEnd - this.holdEnd),
            );
          } else {
            this.alpha = 0;
          }
        }

        draw() {
          if (this.alpha <= 0) return;
          ctx.save();
          ctx.globalAlpha = this.alpha * 0.95;
          // Mobile heart-size adjustment: scales the message font on small screens
          const fontSize = Math.round(15 * mobileMessageFontScale);
          ctx.font = `500 ${fontSize}px 'Quicksand', sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#f0f6ff";
          ctx.shadowColor = "rgba(96, 165, 250, 0.9)";
          ctx.shadowBlur = 12;
          ctx.fillText(this.text, this.x, this.y);
          ctx.restore();
        }

        isDead() {
          return this.life > this.maxLife;
        }
      }

      let heartMessages = [];

      // ================= Twinkling stars (background ambience) =================
      const stars = [];
      const STAR_COUNT = 90;
      for (let i = 0; i < STAR_COUNT; i++) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          r: Math.random() * 1.3 + 0.3,
          baseAlpha: Math.random() * 0.5 + 0.2,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.02 + 0.01,
        });
      }
      let starTime = 0;
      // Draws all stars with a subtle per-star twinkle driven by a sine wave.
      function drawStars() {
        starTime += 1;
        for (const s of stars) {
          const a = s.baseAlpha + Math.sin(starTime * s.speed + s.phase) * 0.25;
          ctx.save();
          ctx.globalAlpha = Math.max(0, a);
          ctx.fillStyle = "#dbe8ff";
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // ================= Ambient floating heart particles =================
      // Background heart that continuously drifts upward and respawns at
      // the bottom once it dies or leaves the top of the screen — independent
      // of any user interaction.
      class AmbientHeartParticle {
        constructor() {
          this.respawn(true);
        }

        respawn(initial = false) {
          this.x = Math.random() * width;
          this.y = initial ? Math.random() * height : height + 15;
          // Mobile heart-size adjustment: enlarges floating heart particles on small screens
          this.size = (Math.random() * 2.5 + 1.8) * mobileParticleScale ;
          this.color = getRandomHeartColor();
          this.vy = -(Math.random() * 0.45 + 0.2);
          this.swayAmp = Math.random() * 25 + 10;
          this.swaySpeed = Math.random() * 0.015 + 0.008;
          this.swayOffset = Math.random() * Math.PI * 2;
          this.rotation = (Math.random() - 0.5) * 0.6;
          this.life = 0;
          this.maxLife = Math.random() * 400 + 400;
        }

        update() {
          this.life++;
          this.y += this.vy;
          this.x +=
            Math.sin(this.life * this.swaySpeed + this.swayOffset) * 0.35;

          const lifeRatio = this.life / this.maxLife;
          if (lifeRatio < 0.12) this.alpha = lifeRatio / 0.12;
          else if (lifeRatio > 0.82)
            this.alpha = Math.max(0, (1 - lifeRatio) / 0.18);
          else this.alpha = 0.85;

          if (this.y < -20 || this.life > this.maxLife) this.respawn();
        }

        draw() {
          drawFilledHeart(
            this.x,
            this.y,
            this.size,
            this.color,
            this.alpha,
            this.rotation,
          );
        }
      }

      const ambientHeartParticles = [];
      for (let i = 0; i < AMBIENT_HEART_COUNT; i++) {
        const p = new AmbientHeartParticle();
        p.life = Math.random() * p.maxLife;
        ambientHeartParticles.push(p);
      }

      // ================= Heart particles (formed on click, also reused for trailing hearts) =================
      // Powers two distinct effects: the click-burst hearts that assemble
      // into a heart shape, and the mouse-trail hearts that just drift and
      // fade without ever forming a shape. Behavior for each variant is
      // controlled via the options object below, so both configurations are
      // visible in one place rather than being set piecemeal after creation.
      class HeartParticle {
        constructor(x, y, options = {}) {
          const {
            formsHeartShape = true, // false = trail heart: drifts/fades in place, no target shape
            lifespanFrames = null, // null = use the default randomized burst lifespan
            velocityDamping = 1, // <1 slows initial outward motion (used for trail hearts)
          } = options;

          this.x = x;
          this.y = y;
          // Individual particle size is intentionally NOT scaled on mobile —
          // only the overall heart formation (see `curveScale` below) grows on
          // small screens, so the shape reads bigger without each particle
          // getting chunkier.
          this.size = Math.random() * 1.8 + 1.2;
          this.color = getRandomHeartColor();
          this.life = 0;
          this.maxLife = lifespanFrames ?? Math.random() * 70 + 110;

          const angle = Math.random() * Math.PI * 2;
          const speed = (Math.random() * 4.5 + 2) * velocityDamping;
          this.vx = Math.cos(angle) * speed;
          this.vy = Math.sin(angle) * speed;
          this.friction = 0.9;

          if (formsHeartShape) {
            const angleOnCurve = Math.random() * Math.PI * 2;
            // Mobile heart-size adjustment: widens the overall heart formation
            // spread on small screens (via mobileFormationScale), independent
            // of individual particle size above.
            const curveScale = (Math.random() * 3 + 7) * mobileFormationScale;
            const target = getPointOnHeartCurve(angleOnCurve, x, y - 10, curveScale);
            this.targetX = target.x;
            this.targetY = target.y;
            this.settleDelay = Math.random() * 18 + 12;
          } else {
            // Trail hearts never settle into a formation, so settleDelay is
            // effectively unreachable within their lifespan.
            this.targetX = x;
            this.targetY = y;
            this.settleDelay = Infinity;
          }

          this.rotation = Math.random() * Math.PI * 2;
        }

        update() {
          this.life++;
          if (this.life < this.settleDelay) {
            this.vx *= this.friction;
            this.vy *= this.friction;
            this.vy += 0.025;
            this.x += this.vx;
            this.y += this.vy;
          } else {
            const ease = 0.055;
            this.x += (this.targetX - this.x) * ease;
            this.y += (this.targetY - this.y) * ease;
            // gentle float upward after settling into heart shape
            this.targetY -= 0.12;
          }

          const lifeRatio = this.life / this.maxLife;
          if (lifeRatio < 0.08) this.alpha = lifeRatio / 0.08;
          else if (lifeRatio > 0.7)
            this.alpha = Math.max(0, (1 - lifeRatio) / 0.3);
          else this.alpha = 1;
        }

        draw() {
          drawFilledHeart(
            this.x,
            this.y,
            this.size,
            this.color,
            this.alpha,
            this.rotation,
          );
        }

        isDead() {
          return this.life > this.maxLife;
        }
      }

      let heartParticles = [];

      // Spawns the full particle burst for one click, plus its centered message.
      function triggerHeartBurst(x, y) {
        for (let i = 0; i < PARTICLES_PER_HEART_BURST; i++)
          heartParticles.push(new HeartParticle(x, y));
        // center message roughly matches the heart's target center (y - 10)
        heartMessages.push(new HeartMessage(x, y - 10));
      }

      // ================= Mouse trail hearts =================
      let lastTrailTime = 0;
      // Spawns a single trailing heart at the pointer position, throttled by
      // TRAIL_THROTTLE_MS to avoid flooding the particle count on fast moves.
      function spawnTrailHeartParticle(x, y) {
        const now = performance.now();
        if (now - lastTrailTime < TRAIL_THROTTLE_MS) return;
        lastTrailTime = now;
        heartParticles.push(
          new HeartParticle(x, y, {
            formsHeartShape: false,
            lifespanFrames: 55,
            velocityDamping: 0.15,
          }),
        );
      }

      // ================= Interaction =================
      // Normalizes mouse and touch coordinates, then triggers a heart burst
      // at the pointer position.
      function handlePointerDown(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        triggerHeartBurst(clientX - rect.left, clientY - rect.top);
      }
      canvas.addEventListener("click", handlePointerDown);
      canvas.addEventListener(
        "touchstart",
        function (e) {
          e.preventDefault();
          handlePointerDown(e);
        },
        { passive: false },
      );

      canvas.addEventListener("mousemove", function (e) {
        const rect = canvas.getBoundingClientRect();
        spawnTrailHeartParticle(e.clientX - rect.left, e.clientY - rect.top);
      });

      // Fire one heart burst automatically at page center on first load.
      window.addEventListener("load", () => {
        triggerHeartBurst(centerX, centerY);
      });

      // ================= Animation loop =================
      // Renders a single frame — background fade, stars, particles, messages —
      // then schedules the next frame via requestAnimationFrame.
      function renderFrame() {
        ctx.fillStyle = "rgba(3, 6, 18, 0.22)";
        ctx.fillRect(0, 0, width, height);

        drawStars();

        for (const p of ambientHeartParticles) {
          p.update();
          p.draw();
        }

        for (let i = heartParticles.length - 1; i >= 0; i--) {
          const p = heartParticles[i];
          p.update();
          p.draw();
          if (p.isDead()) heartParticles.splice(i, 1);
        }
        if (heartParticles.length > MAX_HEART_PARTICLES)
          heartParticles.splice(0, heartParticles.length - MAX_HEART_PARTICLES);

        for (let i = heartMessages.length - 1; i >= 0; i--) {
          const m = heartMessages[i];
          m.update();
          m.draw();
          if (m.isDead()) heartMessages.splice(i, 1);
        }

        requestAnimationFrame(renderFrame);
      }

      renderFrame();