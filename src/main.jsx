import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const GRID_SIZE = 18;
const START_SNAKE = [
  { x: 5, y: 9 },
  { x: 4, y: 9 },
  { x: 3, y: 9 },
  { x: 2, y: 9 },
];

const DIRECTIONS = {
  ArrowUp: { x: 0, y: -1, name: 'up' },
  ArrowDown: { x: 0, y: 1, name: 'down' },
  ArrowLeft: { x: -1, y: 0, name: 'left' },
  ArrowRight: { x: 1, y: 0, name: 'right' },
};

const assetPath = (path) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;

const TREATS = [
  { id: 'strawberry', label: 'Strawberry', points: 10, image: assetPath('assets/sprites/strawberry.png') },
  { id: 'orange', label: 'Orange slice', points: 15, image: assetPath('assets/sprites/orange.png') },
  { id: 'grapes', label: 'Grapes', points: 20, image: assetPath('assets/sprites/grapes.png') },
  { id: 'diamond', label: 'Diamond gem', points: 30, image: assetPath('assets/sprites/diamond.png') },
];

const SPRITES = {
  head: assetPath('assets/sprites/snake-head.png'),
  body: assetPath('assets/sprites/snake-body.png'),
  tail: assetPath('assets/sprites/snake-tail.png'),
  star: assetPath('assets/sprites/star.png'),
};

const BEST_SCORE_KEY = 'armaans-snake-best';
const LEGACY_BEST_SCORE_KEY = 'armans-snake-best';

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

function cellKey(cell) {
  return `${cell.x}:${cell.y}`;
}

function opposite(a, b) {
  return a.x + b.x === 0 && a.y + b.y === 0;
}

function directionFromVector(vector) {
  if (vector.x > 0) return 'right';
  if (vector.x < 0) return 'left';
  if (vector.y > 0) return 'down';
  return 'up';
}

function rotationForDirection(direction) {
  if (direction === 'down') return Math.PI / 2;
  if (direction === 'left') return Math.PI;
  if (direction === 'up') return -Math.PI / 2;
  return 0;
}

function makeFood(snake, allowSelfCrossing = false) {
  const blocked = new Set(snake.map(cellKey));
  let spot = { x: randomInt(GRID_SIZE), y: randomInt(GRID_SIZE) };

  for (let i = 0; i < 500; i += 1) {
    const candidate = { x: randomInt(GRID_SIZE), y: randomInt(GRID_SIZE) };
    if (!blocked.has(cellKey(candidate))) {
      spot = candidate;
      break;
    }
  }

  if (allowSelfCrossing && blocked.size >= GRID_SIZE * GRID_SIZE) {
    spot = { x: randomInt(GRID_SIZE), y: randomInt(GRID_SIZE) };
  }

  const treat = TREATS[randomInt(TREATS.length)];
  return { ...spot, ...treat };
}

function loadImages(sources) {
  const entries = Object.entries(sources);
  return Promise.all(
    entries.map(
      ([key, src]) =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve([key, image]);
          image.onerror = () => resolve([key, null]);
          image.src = src;
        }),
    ),
  ).then((loaded) => Object.fromEntries(loaded));
}

function useGameAudio() {
  const contextRef = useRef(null);

  const ensureAudio = useCallback(() => {
    if (!contextRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      contextRef.current = new AudioContext();
    }
    if (contextRef.current.state === 'suspended') {
      contextRef.current.resume();
    }
    return contextRef.current;
  }, []);

  const tone = useCallback(
    (frequency, duration, delay = 0, type = 'sine', gain = 0.05) => {
      const ctx = ensureAudio();
      if (!ctx) return;
      const oscillator = ctx.createOscillator();
      const volume = ctx.createGain();
      const start = ctx.currentTime + delay;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      volume.gain.setValueAtTime(0.0001, start);
      volume.gain.exponentialRampToValueAtTime(gain, start + 0.015);
      volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(volume);
      volume.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.03);
    },
    [ensureAudio],
  );

  return useMemo(
    () => ({
      wake: ensureAudio,
      eat: () => {
        tone(660, 0.08, 0, 'triangle', 0.045);
        tone(880, 0.1, 0.07, 'triangle', 0.04);
        tone(1175, 0.08, 0.15, 'sine', 0.035);
      },
      bump: () => {
        tone(190, 0.18, 0, 'sawtooth', 0.04);
        tone(120, 0.28, 0.12, 'sawtooth', 0.035);
      },
      click: () => {
        tone(520, 0.04, 0, 'square', 0.018);
        tone(780, 0.04, 0.045, 'square', 0.015);
      },
      celebrate: () => {
        tone(523, 0.08, 0, 'triangle', 0.04);
        tone(659, 0.08, 0.08, 'triangle', 0.04);
        tone(784, 0.12, 0.16, 'triangle', 0.04);
      },
    }),
    [ensureAudio, tone],
  );
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawImageCentered(ctx, image, x, y, size, angle = 0, scale = 1) {
  if (!image) return;
  const drawSize = size * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(image, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
  ctx.restore();
}

function SnakeBoard({ snake, food, direction, status, assets, pulse }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const size = Math.min(rect.width, rect.height);
    const cell = size / GRID_SIZE;
    const radius = cell * 0.18;

    const sky = ctx.createLinearGradient(0, 0, 0, size);
    sky.addColorStop(0, '#bde94d');
    sky.addColorStop(1, '#7fc330');
    ctx.fillStyle = sky;
    drawRoundRect(ctx, 0, 0, size, size, cell * 0.45);
    ctx.fill();

    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const px = x * cell;
        const py = y * cell;
        const tint = (x + y) % 2 === 0 ? 'rgba(255, 255, 255, 0.13)' : 'rgba(36, 99, 17, 0.05)';
        ctx.fillStyle = tint;
        drawRoundRect(ctx, px + cell * 0.06, py + cell * 0.06, cell * 0.88, cell * 0.88, radius);
        ctx.fill();
        ctx.strokeStyle = 'rgba(55, 111, 25, 0.18)';
        ctx.lineWidth = Math.max(1, cell * 0.035);
        ctx.stroke();

        if ((x * 7 + y * 3) % 19 === 0) {
          ctx.fillStyle = 'rgba(82, 142, 37, 0.24)';
          ctx.beginPath();
          ctx.ellipse(px + cell * 0.34, py + cell * 0.66, cell * 0.05, cell * 0.16, -0.7, 0, Math.PI * 2);
          ctx.ellipse(px + cell * 0.47, py + cell * 0.67, cell * 0.05, cell * 0.16, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    const foodImage = assets[food.id];
    const foodX = (food.x + 0.5) * cell;
    const foodY = (food.y + 0.5) * cell;
    const glow = 0.95 + Math.sin(pulse / 180) * 0.06;
    ctx.save();
    ctx.shadowColor = food.id === 'diamond' ? '#42e3ff' : '#ffe25d';
    ctx.shadowBlur = cell * 0.55;
    drawImageCentered(ctx, foodImage, foodX, foodY, cell, 0, food.id === 'diamond' ? 1.52 * glow : 1.35 * glow);
    ctx.restore();

    snake
      .slice()
      .reverse()
      .forEach((segment, reverseIndex) => {
        const index = snake.length - 1 - reverseIndex;
        const cx = (segment.x + 0.5) * cell;
        const cy = (segment.y + 0.5) * cell;

        if (index === 0) {
          const angle = rotationForDirection(direction.name);
          drawImageCentered(ctx, assets.head, cx, cy, cell, angle, 2.15);
          return;
        }

        if (index === snake.length - 1) {
          const next = snake[index - 1] || segment;
          const vector = { x: next.x - segment.x, y: next.y - segment.y };
          const tailDirection = directionFromVector(vector);
          drawImageCentered(ctx, assets.tail, cx, cy, cell, rotationForDirection(tailDirection), 1.85);
          return;
        }

        ctx.save();
        ctx.shadowColor = 'rgba(42, 92, 9, 0.18)';
        ctx.shadowBlur = cell * 0.18;
        drawImageCentered(ctx, assets.body, cx, cy, cell, 0, 1.42);
        ctx.restore();
      });

    if (status !== 'playing') {
      ctx.fillStyle = 'rgba(19, 85, 62, 0.14)';
      drawRoundRect(ctx, cell * 1.4, cell * 1.4, size - cell * 2.8, size - cell * 2.8, cell * 0.7);
      ctx.fill();
    }
  }, [assets, direction, food, pulse, snake, status]);

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Snake game board" />;
}

function Icon({ type }) {
  if (type === 'pause') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
      </svg>
    );
  }
  if (type === 'restart') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.9 10.6a7 7 0 1 0 1.1 3.7h-3a4 4 0 1 1-.8-2.4l-2.2 2.2h7V7.2z" />
      </svg>
    );
  }
  if (type === 'fullscreen') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5h6v2H8.4l3.1 3.1-1.4 1.4L7 8.4V11H5zm8 0h6v6h-2V8.4l-3.1 3.1-1.4-1.4L15.6 7H13zM5 13h2v2.6l3.1-3.1 1.4 1.4L8.4 17H11v2H5zm12 2.6V13h2v6h-6v-2h2.6l-3.1-3.1 1.4-1.4z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 4 13h5v8h6v-8h5z" />
    </svg>
  );
}

function ScoreCard({ label, value, tone }) {
  return (
    <section className={`score-card ${tone}`}>
      <span className="score-icon" aria-hidden="true" />
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </section>
  );
}

function ArrowPad({ onDirection }) {
  return (
    <div className="arrow-pad" aria-label="Arrow controls">
      <button type="button" className="arrow up" onClick={() => onDirection('ArrowUp')} aria-label="Move up">
        <Icon />
      </button>
      <button type="button" className="arrow left" onClick={() => onDirection('ArrowLeft')} aria-label="Move left">
        <Icon />
      </button>
      <button type="button" className="arrow down" onClick={() => onDirection('ArrowDown')} aria-label="Move down">
        <Icon />
      </button>
      <button type="button" className="arrow right" onClick={() => onDirection('ArrowRight')} aria-label="Move right">
        <Icon />
      </button>
    </div>
  );
}

function App() {
  const [assets, setAssets] = useState({});
  const [snake, setSnake] = useState(START_SNAKE);
  const [direction, setDirection] = useState(DIRECTIONS.ArrowRight);
  const directionRef = useRef(DIRECTIONS.ArrowRight);
  const nextDirectionRef = useRef(DIRECTIONS.ArrowRight);
  const [selfCollision, setSelfCollision] = useState(true);
  const selfCollisionRef = useRef(true);
  const [status, setStatus] = useState('ready');
  const statusRef = useRef('ready');
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() =>
    Number(localStorage.getItem(BEST_SCORE_KEY) || localStorage.getItem(LEGACY_BEST_SCORE_KEY) || 0),
  );
  const [food, setFood] = useState(() => makeFood(START_SNAKE));
  const foodRef = useRef(food);
  const snakeRef = useRef(START_SNAKE);
  const [pulse, setPulse] = useState(0);
  const audio = useGameAudio();

  useEffect(() => {
    const sources = {
      ...Object.fromEntries(TREATS.map((treat) => [treat.id, treat.image])),
      ...SPRITES,
    };
    loadImages(sources).then(setAssets);
  }, []);

  useEffect(() => {
    snakeRef.current = snake;
  }, [snake]);

  useEffect(() => {
    foodRef.current = food;
  }, [food]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    selfCollisionRef.current = selfCollision;
  }, [selfCollision]);

  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  useEffect(() => {
    let frame = 0;
    const animate = (time) => {
      setPulse(time);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  const resetGame = useCallback(
    (withSound = true) => {
      directionRef.current = DIRECTIONS.ArrowRight;
      nextDirectionRef.current = DIRECTIONS.ArrowRight;
      setDirection(DIRECTIONS.ArrowRight);
      setSnake(START_SNAKE);
      snakeRef.current = START_SNAKE;
      const nextFood = makeFood(START_SNAKE, !selfCollisionRef.current);
      setFood(nextFood);
      foodRef.current = nextFood;
      setScore(0);
      setStatus('playing');
      statusRef.current = 'playing';
      if (withSound) audio.celebrate();
    },
    [audio],
  );

  const endGame = useCallback(() => {
    setStatus('gameover');
    statusRef.current = 'gameover';
    audio.bump();
  }, [audio]);

  const applyDirection = useCallback(
    (key) => {
      const next = DIRECTIONS[key];
      if (!next) return;
      audio.wake();
      const current = nextDirectionRef.current;
      if (opposite(current, next)) return;
      nextDirectionRef.current = next;
      if (statusRef.current === 'ready') {
        setStatus('playing');
        statusRef.current = 'playing';
      }
      if (statusRef.current === 'gameover') {
        resetGame(false);
        nextDirectionRef.current = next;
      }
    },
    [audio, resetGame],
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      if (DIRECTIONS[event.key]) {
        event.preventDefault();
        applyDirection(event.key);
      }
      if (event.key === ' ' || event.key.toLowerCase() === 'p') {
        event.preventDefault();
        audio.click();
        setStatus((current) => {
          if (current === 'playing') {
            statusRef.current = 'paused';
            return 'paused';
          }
          if (current === 'paused') {
            statusRef.current = 'playing';
            return 'playing';
          }
          return current;
        });
      }
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        resetGame();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyDirection, audio, resetGame]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (statusRef.current !== 'playing') return;

      const currentSnake = snakeRef.current;
      const currentFood = foodRef.current;
      const move = nextDirectionRef.current;
      directionRef.current = move;
      setDirection(move);
      const head = currentSnake[0];
      const nextHead = { x: head.x + move.x, y: head.y + move.y };

      if (nextHead.x < 0 || nextHead.x >= GRID_SIZE || nextHead.y < 0 || nextHead.y >= GRID_SIZE) {
        endGame();
        return;
      }

      const ate = sameCell(nextHead, currentFood);
      const collisionBody = ate ? currentSnake : currentSnake.slice(0, -1);
      const bumpedSelf = collisionBody.some((segment) => sameCell(segment, nextHead));

      if (selfCollisionRef.current && bumpedSelf) {
        endGame();
        return;
      }

      const nextSnake = [nextHead, ...currentSnake];
      if (!ate) nextSnake.pop();

      snakeRef.current = nextSnake;
      setSnake(nextSnake);

      if (ate) {
        audio.eat();
        setScore((current) => {
          const nextScore = current + currentFood.points;
          setBest((currentBest) => {
            const nextBest = Math.max(currentBest, nextScore);
            localStorage.setItem(BEST_SCORE_KEY, String(nextBest));
            return nextBest;
          });
          return nextScore;
        });
        const nextFood = makeFood(nextSnake, !selfCollisionRef.current);
        foodRef.current = nextFood;
        setFood(nextFood);
      }
    }, Math.max(86, 165 - Math.floor(score / 80) * 8));

    return () => window.clearInterval(id);
  }, [audio, endGame, score]);

  const modeLabel = selfCollision ? 'Tail Bumps End Game' : 'Tail Safe Mode';

  const toggleMode = () => {
    audio.click();
    setSelfCollision((current) => !current);
  };

  const togglePause = () => {
    audio.click();
    setStatus((current) => {
      if (current === 'playing') {
        statusRef.current = 'paused';
        return 'paused';
      }
      if (current === 'paused' || current === 'ready') {
        statusRef.current = 'playing';
        return 'playing';
      }
      return current;
    });
  };

  const goFullscreen = async () => {
    audio.click();
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  };

  return (
    <main className="app-shell">
      <div className="sky-pop one" />
      <div className="sky-pop two" />
      <div className="garden left" />
      <div className="garden right" />

      <section className="side-panel left-panel" aria-label="Game score and mode">
        <div className="brand-lockup">
          <img src={SPRITES.star} alt="" />
          <div>
            <h1>Armaan's Snake Garden</h1>
            <p>Eat treats. Dodge walls. Grow huge.</p>
          </div>
        </div>

        <ScoreCard label="Score" value={score} tone="gold" />
        <ScoreCard label="Best" value={best} tone="blue" />

        <section className="mode-card">
          <div className="mode-heading">
            <span>Mode</span>
            <strong>{modeLabel}</strong>
          </div>
          <button
            className={`switch ${selfCollision ? 'on' : 'off'}`}
            type="button"
            role="switch"
            aria-checked={selfCollision}
            aria-label="Toggle self collision mode"
            onClick={toggleMode}
          >
            <span />
          </button>
          <div className="mode-copy">
            <p className={selfCollision ? 'active' : ''}>Tail bumps end the game.</p>
            <p className={!selfCollision ? 'active' : ''}>Tail safe mode lets Armaan keep growing.</p>
          </div>
        </section>
      </section>

      <section className="board-zone" aria-label="Snake game">
        <div className="board-frame">
          <SnakeBoard snake={snake} food={food} direction={direction} status={status} assets={assets} pulse={pulse} />
          {status !== 'playing' && (
            <div className="game-message">
              <img src={SPRITES.head} alt="" />
              <h2>{status === 'gameover' ? 'Bonk! Try again?' : status === 'paused' ? 'Paused' : 'Ready?'}</h2>
              <p>
                {status === 'gameover'
                  ? 'The wall got the snake. Press an arrow key or restart.'
                  : status === 'paused'
                    ? 'Press Space or Pause to keep playing.'
                    : 'Press any arrow key to start.'}
              </p>
              <button type="button" className="primary-action" onClick={() => resetGame()}>
                <Icon type="restart" />
                Start
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="side-panel right-panel" aria-label="Game controls">
        <div className="control-stack">
          <button type="button" className="control-button green" onClick={togglePause}>
            <Icon type="pause" />
            {status === 'paused' ? 'Play' : 'Pause'}
          </button>
          <button type="button" className="control-button orange" onClick={() => resetGame()}>
            <Icon type="restart" />
            Restart
          </button>
          <button type="button" className="control-button blue" onClick={goFullscreen}>
            <Icon type="fullscreen" />
            Full Screen
          </button>
        </div>

        <section className="tip-card">
          <div className="tip-row">
            <img src={TREATS[0].image} alt="" />
            <span>Eat fruit and gems.</span>
          </div>
          <div className="tip-row">
            <img src={TREATS[3].image} alt="" />
            <span>Walls always end the game.</span>
          </div>
          <div className="tip-row">
            <img src={SPRITES.body} alt="" />
            <span>Choose tail rules before playing.</span>
          </div>
        </section>

        <section className="keys-card">
          <strong>Use Arrow Keys</strong>
          <ArrowPad onDirection={applyDirection} />
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
