const express = require('express');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = 3000;
const saltRounds = 10;
const usersFilePath = path.join(__dirname, 'data', 'users.json');

// Função para ler o arquivo JSON de usuários
const readUsersFile = () => {
  const data = fs.readFileSync(usersFilePath, 'utf8');
  return JSON.parse(data);
};

// Função para escrever no arquivo JSON de usuários
const writeUsersFile = (data) => {
  fs.writeFileSync(usersFilePath, JSON.stringify(data, null, 2));
};

// Middlewares
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rota para a página inicial
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota de registro
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  const users = readUsersFile();
  const userExists = users.some(user => user.username === username || user.email === email);

  if (userExists) {
    return res.status(400).send('Username or email already exists');
  }

  const hashedPassword = await bcrypt.hash(password, saltRounds);
  const newUser = { id: users.length + 1, username, email, password: hashedPassword };

  users.push(newUser);
  writeUsersFile(users);

  res.send('Registration successful!');
});

// Rota de login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const users = readUsersFile();
  const user = users.find(user => user.email === email);

  if (!user) {
    return res.status(400).json({ success: false, message: 'User not found' });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    return res.status(400).json({ success: false, message: 'Incorrect password' });
  }

  res.json({ success: true, username: user.username });
});

// Inicializando variáveis do jogo
let players = [];
let bullets = [];
let grenades = [];
let monsters = [];
let crystal = { x: 500, y: 500, hp: 1000 };
let gameRunning = true;
const MONSTER_SPEED = 1; // Velocidade constante dos monstros
const MONSTER_SIZE = 40; // Tamanho da sprite do monstro
const BACKSTEP_DISTANCE = 10; // Distância que o monstro recua ao receber um tiro
let monsterWaveSize = 100; // Quantidade inicial de monstros por onda
let currentMonsterWave = 1; // Onda atual de monstros
let monstersLeft = monsterWaveSize;
let playerScores = {};

// Funções relacionadas ao jogo
function spawnMonster() {
  if (players.length > 0 && gameRunning && monstersLeft > 0) {
    const side = Math.floor(Math.random() * 4);
    let x, y;
    if (side === 0) { x = 0; y = Math.random() * 1000; }
    else if (side === 1) { x = 1000; y = Math.random() * 1000; }
    else if (side === 2) { x = Math.random() * 1000; y = 0; }
    else { x = Math.random() * 1000; y = 1000; }
    const type = Math.floor(Math.random() * 3); // Gera um tipo de monstro aleatório (0, 1 ou 2)
    const hp = type + 1; // Define o HP do monstro com base no tipo
    monsters.push({ x, y, speed: MONSTER_SPEED, type, hp, maxHp: hp, backStep: { x: 0, y: 0 } });
    monstersLeft--;
    updateMonsterProgress();
  }
}

function updateMonsterProgress() {
  const progress = (monstersLeft / monsterWaveSize) * 100;
  io.emit('updateMonsterProgress', { progress, monstersLeft, monsterWaveSize });
}

function startNextWave() {
  currentMonsterWave++;
  monsterWaveSize += 100;
  monstersLeft = monsterWaveSize;

  let newBackground = `images/backgrounds/background${currentMonsterWave}.png`;
  // Verifica se o background existe, se não, usa o próximo número sequencial ou o background1.png se não existir
  if (!fs.existsSync(path.join(__dirname, 'public', newBackground))) {
    newBackground = `images/backgrounds/background${(currentMonsterWave - 1) % 3 + 1}.png`;
  }

  io.emit('startNextWave', { monsterWaveSize, newBackground });
}

setInterval(() => {
  if (monstersLeft === 0 && monsters.length === 0) {
    setTimeout(startNextWave, 10000); // Inicia a próxima onda após 10 segundos
  } else {
    spawnMonster();
  }
}, 1000);

function updateGame() {
  if (!gameRunning) return;

  bullets.forEach(bullet => {
    bullet.x += (bullet.targetX - bullet.x) / 7;
    bullet.y += (bullet.targetY - bullet.y) / 7;
  });

  bullets = bullets.filter(bullet => Math.abs(bullet.x - bullet.targetX) > 5 || Math.abs(bullet.y - bullet.targetY) > 5);

  bullets = bullets.filter(bullet => {
    let hit = false;
    monsters = monsters.filter(monster => {
      const dx = bullet.x - monster.x;
      const dy = bullet.y - monster.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < MONSTER_SIZE / 2) { // Considere o tamanho do monstro para a colisão
        monster.hp -= 1;
        monster.backStep = { x: -dx / distance * BACKSTEP_DISTANCE, y: -dy / distance * BACKSTEP_DISTANCE }; // Aplicar o efeito de retrocesso
        if (monster.hp <= 0) {
          io.emit('deathSound'); // Emite o som da morte
          // Atualize a pontuação do jogador que matou o monstro
          const player = players.find(p => p.id === bullet.playerId);
          if (player) {
            if (!playerScores[player.name]) {
              playerScores[player.name] = 0;
            }
            playerScores[player.name]++;
            io.emit('updateScoreboard', playerScores);
          }
          return false; // Remove o monstro da lista
        }
        hit = true;
      }
      return true;
    });
    return !hit;
  });

  monsters.forEach(monster => {
    if (monster.backStep.x !== 0 || monster.backStep.y !== 0) {
      monster.x += monster.backStep.x;
      monster.y += monster.backStep.y;
      monster.backStep = { x: 0, y: 0 };
    } else {
      const dx = crystal.x - monster.x;
      const dy = crystal.y - monster.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      monster.x += (dx / dist) * monster.speed;
      monster.y += (dy / dist) * monster.speed;

      if (dist < 20) {
        crystal.hp -= 2;
        monster.remove = true;
        if (crystal.hp <= 0) {
          gameRunning = false;
          io.emit('crystalDestroyed');
        }
      }

      players.forEach(player => {
        const playerDist = Math.sqrt((player.x - monster.x) ** 2 + (player.y - monster.y) ** 2);
        if (playerDist < MONSTER_SIZE / 2 && player.isActive) {
          player.hp -= 5;
          io.emit('somDorAleatorio');
          monster.remove = true; // Marca o monstro para remoção
          if (player.hp <= 0) {
            player.hp = 0;
            player.isActive = false;
          }
          io.to(player.id).emit('playerDamaged'); // Emite o evento de dano para o jogador
        }
      });
    }
  });

  monsters = monsters.filter(monster => !monster.remove);

  grenades.forEach(grenade => {
    grenade.timer--;
    if (grenade.timer <= 0) {
      const explosionRadius = 80;
      monsters = monsters.filter(monster => {
        const dx = grenade.x - monster.x;
        const dy = grenade.y - monster.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < explosionRadius) {
          io.emit('deathSound'); // Emite o som da morte
          io.emit('monsterKilled', { playerId: grenade.playerId });
          return false;
        }
        return true;
      });
      io.emit('explosionSound'); // Emite o som de explosão
      io.emit('explosionParticles', { x: grenade.x, y: grenade.y });
      grenade.remove = true;
      // Permite o jogador lançar outra granada após a explosão
      const player = players.find(p => p.id === grenade.playerId);
      if (player) {
        player.canThrowGrenade = true;
      }
    }
  });

  grenades = grenades.filter(grenade => !grenade.remove);

  io.emit('update', { players, bullets, grenades, monsters, crystal });
}

setInterval(updateGame, 1000 / 60);

io.on('connection', socket => {
  const player = { id: socket.id, name: '', x: 500, y: 500, bullets: 7, hp: 100, maxHp: 100, direction: 'down', angle: 0, canThrowGrenade: true, isActive: true }; // Adicione a variável canThrowGrenade
  players.push(player);

  socket.on('setUsername', ({ username }) => {
    const player = players.find(p => p.id === socket.id);
    if (player) {
      player.name = username;
      if (!playerScores[player.name]) {
        playerScores[player.name] = 0;
      }
      io.emit('updateScoreboard', playerScores);
    }
  });

  socket.on('updateMouse', ({ mouseX, mouseY }) => {
    const player = players.find(p => p.id === socket.id);
    if (player) {
      player.angle = Math.atan2(mouseY - player.y, mouseX - player.x);
      io.emit('updateMouse', { playerId: player.id, angle: player.angle });
    }
  });

  socket.on('disconnect', () => {
    const player = players.find(p => p.id === socket.id);
    if (player) {
      delete playerScores[player.name];
      io.emit('updateScoreboard', playerScores);
    }
    players = players.filter(p => p.id !== socket.id);
  });

  socket.on('updatePosition', ({ x, y }) => {
    const player = players.find(p => p.id === socket.id);
    if (player) {
      player.x = x;
      player.y = y;
    }
  });

  socket.on('playerDamaged', () => {
    isDamaged = true;
    damageFlashTimer = 10; // Define o tempo do flash de dano
  });

  socket.on('shoot', ({ x, y }) => {
    const player = players.find(p => p.id === socket.id);
    if (player && player.bullets > 0 && player.isActive) {
      bullets.push({ x: player.x, y: player.y, targetX: x, targetY: y, playerId: player.id });
      player.bullets--;
      if (player.bullets === 0) {
        io.emit('reloadMessage', player.id);
      }
      io.emit('shootSound'); // Emite o som do tiro
    } else {
      io.emit('reloadMessage', player.id);
      io.emit('reloadFala', player.id); // Emite o som de recarregamento Fala
    }
  });

  socket.on('throwGrenade', ({ x, y }) => {
    const player = players.find(p => p.id === socket.id);
    if (player && player.canThrowGrenade && player.isActive) {
      io.emit('granadeFala'); // Emite o som fala granada
      grenades.push({ x, y, timer: 120, playerId: player.id }); // Granadas explodem após 2 segundos (120 frames)
      player.canThrowGrenade = false; // Impede o lançamento de outra granada até a explosão
    }
  });

  socket.on('reload', () => {
    const player = players.find(p => p.id === socket.id);
    if (player && player.bullets === 0) {
      player.bullets = 7;
      io.emit('reloadSound'); // Emite o som de recarregamento
    }
  });

  socket.on('respawn', () => {
    const player = players.find(p => p.id === socket.id);
    if (player) {
      player.x = 500;
      player.y = 500;
      player.hp = 100;
      player.isActive = true;
    }
  });

  socket.on('restart', () => {
    crystal.hp = 1000;
    gameRunning = true;
    monsters = [];
    players.forEach(player => player.canThrowGrenade = true); // Permite lançar granadas após reiniciar
    io.emit('restartGame');
  });
});

server.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
