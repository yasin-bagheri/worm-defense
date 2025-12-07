import Phaser from "phaser";

/*
  Final Safe GameScene (TypeScript + Phaser 3)
  - Player (worm) NEVER destroyed by game logic
  - Collisions with enemies/enemy bullets reduce LIVES by 1 (not health)
  - Shoot toward mouse on click and with SPACE (toward current pointer)
  - Enemies spawn from left and move toward player; from wave 3 some shoot
  - Player bullets can destroy enemy bullets
  - Defensive checks and safeDestroy wrapper to avoid destroying worm or calling methods on undefined
*/

const PLAYER_SPEED = 260;
const PLAYER_BULLET_SPEED = 520;
const PLAYER_SHOOT_COOLDOWN = 160;

const ENEMY_BASE_SPEED = 50;
const ENEMY_SPEED_PER_WAVE = 10;
const ENEMY_BULLET_SPEED = 180;

const INVULNERABLE_MS_AFTER_HIT = 700;
const HEART_HEAL_AMOUNT = 28;

export default class GameScene extends Phaser.Scene {
  private worm!: Phaser.Physics.Arcade.Sprite;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;

  private enemies!: Phaser.Physics.Arcade.Group;
  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;
  private hearts!: Phaser.Physics.Arcade.Group;

  private gameStarted = false;
  private isGameOver = false;
  private invulnerable = false;

  private lastPlayerShotAt = 0;
  private score = 0;
  private scoreText!: Phaser.GameObjects.Text;

  // health (only changed by hearts)
  private health = 100;
  private maxHealth = 100;
  private healthText!: Phaser.GameObjects.Text;

  // lives decreases on collisions
  private lives = 3;
  private livesText!: Phaser.GameObjects.Text;

  private wave = 1;
  private enemiesPerWave = 4;

  constructor() {
    super({ key: 'GameScene' });
  }

  preload() {
    // adjust asset paths if necessary
    this.load.image('background', '/underwater-game-landscape.avif');
    this.load.image('worm', '/worm.png');
    this.load.image('enemy', '/enemy.png');
    this.load.image('bullet', '/bullet.png');
    this.load.image('enemyBullet', '/enemy-bullet.png');
    this.load.image('heart', '/heart-bubble.png');
  }

  create() {
    // background
    const bg = this.add.image(0, 0, 'background').setOrigin(0);
    bg.displayWidth = this.scale.width;
    bg.displayHeight = this.scale.height;

    // player (worm) — created once and never destroyed
    const startX = Math.round(this.scale.width * 0.5);
    const startY = Math.round(this.scale.height * 0.78);
    this.worm = this.physics.add.sprite(startX, startY, 'worm').setScale(0.22);
    this.worm.setCollideWorldBounds(true);

    // groups
    this.enemies = this.physics.add.group();
    this.playerBullets = this.physics.add.group();
    this.enemyBullets = this.physics.add.group();
    this.hearts = this.physics.add.group();

    // input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // UI texts
    this.scoreText = this.add.text(12, 12, `Score: ${this.score}`, { fontSize: '18px', color: '#ffffff' });
    this.healthText = this.add.text(12, 34, `Health: ${this.health}`, { fontSize: '16px', color: '#00ff88' });
    this.livesText = this.add.text(this.scale.width - 12, 12, '❤️'.repeat(this.lives), { fontSize: '18px', color: '#ffffff' }).setOrigin(1, 0);

    // overlaps with safe casting & active checks

    // player bullets -> enemy
    this.physics.add.overlap(this.playerBullets, this.enemies, (playerB, enemyObj) => {
      const bullet = playerB as Phaser.Physics.Arcade.Image;
      const enemy = enemyObj as Phaser.Physics.Arcade.Sprite;
      if (!bullet?.active || !enemy?.active) return;

      // ensure we won't accidentally destroy the worm
      if (enemy === this.worm) {
        console.warn('Attempted to destroy worm as enemy — blocked.');
        return;
      }

      this.safeDestroy(bullet);
      this.safeDestroy(enemy);
      this.addScore(10);
    });

    // player bullets -> enemy bullets (intercept)
    this.physics.add.overlap(this.playerBullets, this.enemyBullets, (playerB, enemyB) => {
      const pb = playerB as Phaser.Physics.Arcade.Image;
      const eb = enemyB as Phaser.Physics.Arcade.Image;
      if (pb?.active) this.safeDestroy(pb);
      if (eb?.active) this.safeDestroy(eb);
    });

    // enemy bullets -> worm (lose life)
    this.physics.add.overlap(this.enemyBullets, this.worm, (enemyB, wormObj) => {
      const eb = enemyB as Phaser.Physics.Arcade.Image;
      if (eb?.active) this.safeDestroy(eb);
      if (this.invulnerable || this.isGameOver) return;
      this.loseLife();
    });

    // enemies -> worm (each enemy only once)
    this.physics.add.overlap(this.enemies, this.worm, (enemyObj, wormObj) => {
      const enemy = enemyObj as Phaser.Physics.Arcade.Sprite;
      if (!enemy?.active) return;
      const hasHit = enemy.getData('hasHit') as boolean | undefined;
      if (hasHit) return;
      if (this.invulnerable || this.isGameOver) return;

      enemy.setData('hasHit', true);
      this.loseLife();

      // destroy enemy after it hit
      this.safeDestroy(enemy);
    });

    // player bullets -> hearts (collect by shooting)
    this.physics.add.overlap(this.playerBullets, this.hearts, (pbObj, heartObj) => {
      const pb = pbObj as Phaser.Physics.Arcade.Image;
      const h = heartObj as Phaser.Physics.Arcade.Image;
      if (pb?.active) this.safeDestroy(pb);
      if (h?.active) {
        this.safeDestroy(h);
        this.heal(HEART_HEAL_AMOUNT);
      }
    });

    // mouse click shoots toward pointer
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.gameStarted || this.isGameOver) return;
      this.shootAt(pointer.worldX, pointer.worldY);
    });

    // show start overlay
    this.showStartOverlay();
  }

  update(time: number) {
    if (!this.gameStarted || this.isGameOver) return;

    // defensive: worm and its body must exist
    if (!this.worm || !this.worm.body) return;

    // movement: only setVelocity on worm if body exists
    let vx = 0;
    let vy = 0;
    if (this.cursors.left?.isDown || this.keyA.isDown) vx = -PLAYER_SPEED;
    else if (this.cursors.right?.isDown || this.keyD.isDown) vx = PLAYER_SPEED;
    if (this.cursors.up?.isDown) vy = -PLAYER_SPEED;
    else if (this.cursors.down?.isDown) vy = PLAYER_SPEED;

    if (this.worm && this.worm.body) this.worm.setVelocity(vx, vy);

    // Space shoots toward current pointer position
    const pointer = this.input.activePointer;
    if (Phaser.Input.Keyboard.JustDown(this.keySpace) && !this.isGameOver) {
      this.shootAt(pointer.worldX, pointer.worldY);
      this.lastPlayerShotAt = time;
    } else if (this.keySpace.isDown && time - this.lastPlayerShotAt > PLAYER_SHOOT_COOLDOWN) {
      this.shootAt(pointer.worldX, pointer.worldY);
      this.lastPlayerShotAt = time;
    }

    // move enemies safely toward worm
    const speed = ENEMY_BASE_SPEED + (this.wave - 1) * ENEMY_SPEED_PER_WAVE;
    const enemies = this.enemies.getChildren() as Phaser.Physics.Arcade.Sprite[];
    for (const enemy of enemies) {
      if (!enemy || !enemy.active) continue;
      if (enemy.body && this.worm && this.worm.active && this.worm.body) {
        // safe move
        this.physics.moveToObject(enemy, this.worm, speed);
      } else if (enemy.body) {
        enemy.setVelocityX(40);
      }
    }

    // cleanup and UI update
    this.cleanupObjects();
    this.updateUI();
  }

  // ---------- helpers ----------

  // Safe destroy wrapper: prevents destroying worm and checks active
  private safeDestroy(obj?: Phaser.GameObjects.GameObject | null) {
    if (!obj) return;
    // If it's the player's worm, block destroy and warn
    if (obj === (this.worm as unknown as Phaser.GameObjects.GameObject)) {
      console.warn('safeDestroy blocked: attempted to destroy player worm.');
      return;
    }
    // Many Phaser objects have active property
    // @ts-ignore
    if (obj.active === false) return;
    try {
      // @ts-ignore
      if (typeof obj.destroy === 'function') obj.destroy();
    } catch (err) {
      console.warn('safeDestroy error', err);
    }
  }

  // shooting toward target (mouse or pointer)
  private shootAt(targetX: number, targetY: number) {
    if (!this.gameStarted || this.isGameOver) return;
    if (!this.worm || !this.worm.active) return;

    const b = this.playerBullets.create(this.worm.x, this.worm.y - 14, 'bullet') as Phaser.Physics.Arcade.Image;
    if (!b) return;
    b.setScale(0.12);

    // validate pointer coords; fallback upward
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
      targetX = this.worm.x;
      targetY = this.worm.y - 100;
    }

    const angle = Phaser.Math.Angle.Between(b.x, b.y, targetX, targetY);
    const vx = Math.cos(angle) * PLAYER_BULLET_SPEED;
    const vy = Math.sin(angle) * PLAYER_BULLET_SPEED;
    b.setVelocity(vx, vy);
    b.setRotation(angle);
  }

  // spawn wave — enemies come from left
  private spawnWave() {
    if (!this.gameStarted || this.isGameOver) return;

    const count = this.enemiesPerWave;
    const spawnDelay = Math.max(220, 900 - Math.min(this.wave * 60, 600));
    let spawned = 0;

    const spawnTimer = this.time.addEvent({
      delay: spawnDelay,
      loop: true,
      callback: () => {
        if (this.isGameOver || spawned >= count) {
          spawnTimer.remove(false);
          return;
        }

        const x = -40;
        const y = Phaser.Math.Between(60, Math.max(120, this.scale.height - 220));
        const enemy = this.enemies.create(x, y, 'enemy') as Phaser.Physics.Arcade.Sprite;
        if (!enemy) return;
        enemy.setScale(0.16); // slightly smaller
        enemy.setData('hasHit', false);

        // shooter chance from wave 3
        const shooterChance = this.wave >= 3 ? 0.45 : 0;
        const isShooter = Math.random() < shooterChance;
        enemy.setData('isShooter', isShooter);

        // safe initial velocity
        if (enemy.body) enemy.setVelocityX(40 + Math.min(this.wave * 18, 220));

        if (isShooter) {
          const shootTimer = this.time.addEvent({
            delay: Phaser.Math.Between(1200, 2200) - Math.min((this.wave - 3) * 50, 500),
            loop: true,
            callback: () => {
              if (!enemy.active || this.isGameOver) {
                shootTimer.remove(false);
                return;
              }
              const eb = this.enemyBullets.create(enemy.x + 8, enemy.y, 'enemyBullet') as Phaser.Physics.Arcade.Image;
              if (!eb) return;
              eb.setScale(0.09);
              if (this.worm && this.worm.active && this.worm.body) {
                this.physics.moveTo(eb, this.worm.x, this.worm.y, ENEMY_BULLET_SPEED + Math.min(this.wave * 12, 360));
              } else if (eb.body) {
                eb.setVelocityX(80);
              }
            }
          });

          enemy.once('destroy', () => {
            if (shootTimer) shootTimer.remove(false);
          });
        }

        spawned++;
      }
    });

    // when wave fully spawned, wait until all dead then advance
    const checkWaveTimer = this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        if (this.isGameOver) {
          checkWaveTimer.remove(false);
          return;
        }
        if (spawned >= count && this.enemies.countActive(true) === 0) {
          checkWaveTimer.remove(false);
          this.wave++;
          this.enemiesPerWave = Math.min(12, this.enemiesPerWave + 1);
          this.time.delayedCall(700, () => {
            if (!this.isGameOver) this.spawnWave();
          });
        }
      }
    });
  }

  private spawnHeart() {
    const y = Phaser.Math.Between(80, this.scale.height - 140);
    const heart = this.hearts.create(-20, y, 'heart') as Phaser.Physics.Arcade.Image;
    if (!heart) return;
    heart.setScale(0.06); // small
    if (heart.body) heart.setVelocityX(70);
  }

  // lose one life (not health)
  private loseLife() {
    if (this.isGameOver) return;

    this.invulnerable = true;
    if (this.worm && this.worm.active) this.worm.setTint(0xff6666);

    this.time.delayedCall(INVULNERABLE_MS_AFTER_HIT, () => {
      this.invulnerable = false;
      if (this.worm && this.worm.active) this.worm.clearTint();
    });

    this.lives--;
    if (this.lives <= 0) {
      this.lives = 0;
      this.endGame();
      return;
    }

    // per your request, do NOT modify health when losing a life
    this.updateUI();
  }

  private heal(amount: number) {
    if (this.isGameOver) return;
    this.health = Phaser.Math.Clamp(this.health + amount, 0, this.maxHealth);
    this.updateUI();
  }

  private addScore(n: number) {
    this.score += n;
    this.updateUI();
  }

  private endGame() {
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.gameStarted = false;

    this.playerBullets.clear(true, true);
    this.enemyBullets.clear(true, true);
    this.hearts.clear(true, true);

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const overlay = this.add.rectangle(cx, cy, this.scale.width * 0.85, 160, 0x000000, 0.75).setDepth(2000);
    this.add.text(cx, cy - 36, 'GAME OVER', { fontSize: '40px', color: '#ff3333' }).setOrigin(0.5).setDepth(2001);
    this.add.text(cx, cy + 0, `Score: ${this.score}`, { fontSize: '20px', color: '#ffffff' }).setOrigin(0.5).setDepth(2001);

    const restart = this.add.text(cx, cy + 48, 'RESTART', { fontSize: '22px', color: '#fff', backgroundColor: '#ff3333', padding: { left: 14, right: 14, top: 8, bottom: 8 } }).setOrigin(0.5).setInteractive().setDepth(2002);
    restart.on('pointerdown', () => {
      overlay.destroy();
      restart.destroy();
      this.scene.restart();
    });
  }

  private cleanupObjects() {
    const pBullets = this.playerBullets.getChildren() as Phaser.Physics.Arcade.Image[];
    for (const pb of pBullets) {
      if (!pb || !pb.active) continue;
      if (pb.y < -80 || pb.x < -80 || pb.x > this.scale.width + 80) this.safeDestroy(pb);
    }

    const eBullets = this.enemyBullets.getChildren() as Phaser.Physics.Arcade.Image[];
    for (const eb of eBullets) {
      if (!eb || !eb.active) continue;
      if (eb.y > this.scale.height + 200 || eb.x < -200 || eb.x > this.scale.width + 200) this.safeDestroy(eb);
    }

    const enemies = this.enemies.getChildren() as Phaser.Physics.Arcade.Sprite[];
    for (const e of enemies) {
      if (!e || !e.active) continue;
      if (e.x > this.scale.width + 160) this.safeDestroy(e);
    }

    const hearts = this.hearts.getChildren() as Phaser.Physics.Arcade.Image[];
    for (const h of hearts) {
      if (!h || !h.active) continue;
      if (h.x > this.scale.width + 60) this.safeDestroy(h);
    }
  }

  private updateUI() {
    this.scoreText.setText(`Score: ${this.score}`);
    this.healthText.setText(`Health: ${Math.max(0, Math.floor(this.health))}`);
    this.livesText.setText('❤️'.repeat(this.lives));
  }

  private showStartOverlay() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const overlay = this.add.rectangle(cx, cy, this.scale.width * 0.9, 220, 0x000000, 0.6).setDepth(1000);
    const title = this.add.text(cx, cy - 62, 'UNDERWATER DEFENDER', { fontSize: '34px', color: '#ffffff' }).setOrigin(0.5).setDepth(1001);
    const info = this.add.text(cx, cy - 14, 'Use ← → or A/D and ↑/↓ to move.\nClick mouse or press SPACE to shoot toward the cursor.\nFrom wave 3 some fish can shoot.\nWhen hit by fish or enemy-bullet you lose 1 life (not health).', { fontSize: '16px', color: '#cccccc', align: 'center' }).setOrigin(0.5).setDepth(1001);
    const startBtn = this.add.text(cx, cy + 62, 'START', { fontSize: '28px', color: '#ffffff', backgroundColor: '#1e90ff', padding: { left: 18, right: 18, top: 10, bottom: 10 } }).setOrigin(0.5).setInteractive().setDepth(1002);

    startBtn.on('pointerdown', () => {
      overlay.destroy();
      title.destroy();
      info.destroy();
      startBtn.destroy();
      this.startGame();
    });
  }

  private startGame() {
    this.gameStarted = true;
    this.isGameOver = false;
    this.invulnerable = false;

    this.score = 0;
    this.health = this.maxHealth;
    this.lives = 3;
    this.wave = 1;
    this.enemiesPerWave = 4;

    this.enemies.clear(true, true);
    this.playerBullets.clear(true, true);
    this.enemyBullets.clear(true, true);
    this.hearts.clear(true, true);

    // spawn hearts periodically
    this.time.addEvent({
      delay: Phaser.Math.Between(7000, 10000),
      loop: true,
      callback: () => {
        if (!this.gameStarted || this.isGameOver) return;
        this.spawnHeart();
      }
    });

    // spawn first wave
    this.spawnWave();
  }
}
