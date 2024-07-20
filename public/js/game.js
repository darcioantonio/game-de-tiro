const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let players = [];
let bullets = [];
let grenades = [];
let monsters = [];
let crystal = { x: 500, y: 500, hp: 1000 };
let reloadMessages = [];
let shaking = false;
let shakeInterval;
let shakeIntensity = 10;
let slashAnimations = [];
let playerScores = {};

const backgroundImage = new Image();
backgroundImage.src = 'images/backgrounds/background1.png'; // Caminho para a sua imagem de fundo
const bulletImage = new Image();
bulletImage.src = 'images/bala.png'; // Caminho para a sua imagem de bala
const playerImage = new Image();
playerImage.src = 'images/player.png'; // Caminho para a sua imagem do jogador
const shotImage = new Image();
shotImage.src = 'images/disparo.png'; // Caminho para a sua imagem de disparo
const crosshairImage = new Image();
crosshairImage.src = 'images/mira.png'; // Caminho para a sua imagem de mira
const grenadeImage = new Image();
grenadeImage.src = 'images/granada.png'; // Caminho para a sua imagem de granada

const shotSound = new Audio('som/tiro.mp3'); // Caminho para o som de tiro
const deathSoundMonster = [new Audio('som/morte1.mp3'), new Audio('som/morte2.mp3'), new Audio('som/morte3.mp3'), new Audio('som/morte4.mp3'), new Audio('som/morte5.mp3')]; // Caminho para o som de morte
const reloadFala = new Audio('som/reload.mp3'); // Som Reload
const sonsDor = [new Audio('som/dor1.mp3'), new Audio('som/dor2.mp3'), new Audio('som/dor3.mp3')]; // Som quando o monstro encosta
const reloadSound = new Audio('som/recarregando.mp3'); // Caminho para o som de recarregamento
const explosionSound = new Audio('som/explosao.mp3'); // Caminho para o som de explosão
const granadeFala = new Audio('som/granadevoz.mp3'); // Caminho para o som de explosão

let mouseX = 0;
let mouseY = 0;

const monsterImages = [];
for (let i = 1; i <= 3; i++) { // Assumindo que há 3 tipos de inimigos
    const img = new Image();
    img.src = `images/inimigos/inimigo${i}.png`; // Caminho para as imagens dos inimigos
    img.onerror = () => console.error(`Erro ao carregar a imagem ${img.src}.`);
    monsterImages.push(img);
}

canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;
    socket.emit('updateMouse', { mouseX, mouseY });
});

canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const player = players.find(p => p.id === socket.id);
    if (player && player.isActive) {
        slashAnimations.push({ x: player.x, y: player.y, angle: player.angle, time: 0 });
    }
});

function drawRotatedImage(ctx, image, x, y, angle, offset = 0) {
    if (!image.complete || image.naturalWidth === 0) {
        console.error('Imagem não carregada corretamente:', image.src);
        return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + offset); // Adiciona a rotação extra
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
    ctx.restore();
}

function updateScoreboard() {
    const scoreboard = document.getElementById('playerScores');
    scoreboard.innerHTML = ''; // Limpa a lista

    // Ordena os jogadores pela pontuação
    const sortedPlayers = Object.entries(playerScores).sort((a, b) => b[1] - a[1]);

    sortedPlayers.forEach(([player, score]) => {
        const listItem = document.createElement('li');
        listItem.textContent = `${player}: ${score}`;
        scoreboard.appendChild(listItem);
    });
}

let keysPressed = {
    w: false,
    a: false,
    s: false,
    d: false
};

document.addEventListener('keydown', (event) => {
    if (['w', 'a', 's', 'd'].includes(event.key)) {
        keysPressed[event.key] = true;
    } else if (event.key === 'r') {
        socket.emit('reload');
    } else if (event.key === 'g') {
        socket.emit('throwGrenade', { x: mouseX, y: mouseY });
    }
});

document.addEventListener('keyup', (event) => {
    if (['w', 'a', 's', 'd'].includes(event.key)) {
        keysPressed[event.key] = false;
    }
});

function updatePlayerPosition(deltaTime) {
    const player = players.find(p => p.id === socket.id);
    if (!player || !player.isActive) return;

    let speed = 200 * (deltaTime / 1000); // Velocidade do jogador ajustada para o deltaTime

    if (keysPressed.w) player.y -= speed;
    if (keysPressed.a) player.x -= speed;
    if (keysPressed.s) player.y += speed;
    if (keysPressed.d) player.x += speed;

    // Enviar a posição atualizada para o servidor
    socket.emit('updatePosition', { x: player.x, y: player.y });
}

let previousUpdateTime = performance.now();

function drawPlayerHealthBar(x, y, width, height, value, maxValue) {
    ctx.fillStyle = 'red';
    ctx.fillRect(x, y, width, height);

    const percentage = Math.max(0, value / maxValue);
    ctx.fillStyle = 'green';
    ctx.fillRect(x, y, width * percentage, height);

    ctx.lineWidth = 1; // Ajuste a espessura da borda aqui (valor menor para borda mais fina)
    ctx.strokeStyle = 'black';
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = 'white';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center'; // Alinha o texto ao centro
    ctx.textBaseline = 'middle'; // Alinha verticalmente ao meio
    ctx.fillText(`${value}/${maxValue}`, x + width / 2, y + height / 2);
}

function drawSlashEffect(slash) {
    const { x, y, angle, time } = slash;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.arc(0, 0, 80, 0, Math.PI, false); // Meio círculo
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = `rgba(255, 255, 255, ${1 - time / 20})`; // Desvanece com o tempo
    ctx.fill();
    ctx.restore();
    slash.time += 1;
}

function draw() {
    let now = performance.now();
    let deltaTime = now - previousUpdateTime;
    previousUpdateTime = now;

    if (shaking) {
        const dx = Math.random() * shakeIntensity - shakeIntensity / 2;
        const dy = Math.random() * shakeIntensity - shakeIntensity / 2;
        ctx.translate(dx, dy);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background
    ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);

    // Draw crystal
    ctx.fillStyle = 'blue';
    ctx.beginPath();
    ctx.arc(crystal.x, crystal.y, 20, 0, Math.PI * 2);
    ctx.fill();

    // Draw crystal health bar
    drawHealthBar(crystal.x - 50, crystal.y + 30, 100, 10, crystal.hp, 1000);

    // Atualizar a posição do jogador
    updatePlayerPosition(deltaTime);

    // Draw players and bullets count
    players.forEach(player => {
        // Calculate angle between player and mouse only if it's the current player's character
        let angle = 0;
        if (player.id === socket.id) {
            angle = Math.atan2(mouseY - player.y, mouseX - player.x);
        } else {
            angle = player.angle; // Use the stored angle for other players
        }

        // Draw rotated player image
        drawRotatedImage(ctx, playerImage, player.x, player.y, angle);

        // Draw player name
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 4;
        ctx.strokeText(player.name || 'Player', player.x, player.y - 35);
        ctx.fillStyle = 'white';
        ctx.fillText(player.name || 'Player', player.x, player.y - 35);

        // Draw player health bar
        drawPlayerHealthBar(player.x - 25, player.y - 25, 50, 10, player.hp, player.maxHp);

        // Draw bullet image and bullets count
        ctx.drawImage(bulletImage, player.x - 10, player.y + 20, 20, 20); // Desenha a imagem da bala
        ctx.font = '20px Arial';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.strokeText(`${player.bullets}/7`, player.x + 20, player.y + 35); // Desenha a contagem de balas com borda preta
        ctx.fillStyle = 'white';
        ctx.fillText(`${player.bullets}/7`, player.x + 20, player.y + 35); // Desenha a contagem de balas ao lado da imagem
    });

    // Draw bullets
    bullets.forEach(bullet => {
        ctx.drawImage(shotImage, bullet.x - shotImage.width / 2, bullet.y - shotImage.height / 2);
    });

    // Draw grenades
    grenades.forEach(grenade => {
        // Draw explosion radius
        ctx.fillStyle = 'rgba(255, 0, 0, 0.08)'; // Cor vermelha com opacidade de 8%
        ctx.beginPath();
        ctx.arc(grenade.x, grenade.y, 80, 0, Math.PI * 2); // Raio de 80 pixels
        ctx.fill();

        // Draw grenade
        ctx.drawImage(grenadeImage, grenade.x - grenadeImage.width / 2, grenade.y - grenadeImage.height / 2);

        // Draw timer countdown
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'white';
        ctx.fillText(Math.ceil(grenade.timer / 60), grenade.x, grenade.y + 10); // Mostra o tempo restante
    });

    // Draw monsters
    monsters.forEach(monster => {
        const angle = Math.atan2(crystal.y - monster.y, crystal.x - monster.x);
        const monsterImage = monsterImages[monster.type];
        drawRotatedImage(ctx, monsterImage, monster.x, monster.y, angle, Math.PI / 2); // Rotaciona a imagem do monstro para a frente

        // Draw monster HP
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.strokeText(`${monster.hp}/${monster.maxHp}`, monster.x, monster.y - 25);
        ctx.fillStyle = 'white';
        ctx.fillText(`${monster.hp}/${monster.maxHp}`, monster.x, monster.y - 25);
    });

    // Draw reload messages
    reloadMessages.forEach((message, index) => {
        ctx.font = 'bold 16px Arial';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.strokeText('Reload!', message.x, message.y);
        ctx.fillStyle = 'white';
        ctx.fillText('Reload!', message.x, message.y);
        message.y -= 1; // Make the message move upwards
        if (message.y < message.initialY - 30) {
            reloadMessages.splice(index, 1); // Remove the message after it moves up 30 pixels
        }
    });

    // Draw slash effects
    slashAnimations.forEach((slash, index) => {
        if (slash.time > 20) {
            slashAnimations.splice(index, 1);
        } else {
            drawSlashEffect(slash);
        }
    });

    // Atualiza e desenha partículas
    updateParticles();
    drawParticles(ctx);

    // Draw crosshair at the mouse position
    ctx.drawImage(crosshairImage, mouseX - crosshairImage.width / 2, mouseY - crosshairImage.height / 2);

    if (shaking) {
        ctx.translate(-dx, -dy);
    }

    requestAnimationFrame(draw);
}

function drawHealthBar(x, y, width, height, value, maxValue) {
    ctx.fillStyle = 'red';
    ctx.fillRect(x, y, width, height);

    const percentage = Math.max(0, value / maxValue);
    ctx.fillStyle = 'green';
    ctx.fillRect(x, y, width * percentage, height);

    ctx.strokeStyle = 'black';
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = 'black';
    ctx.font = '10px Arial';
    ctx.fillText(`${value}/${maxValue}`, x + width / 2 - 15, y + height / 2 + 3);
}

function startShaking() {
    shaking = true;
    shakeInterval = setInterval(() => {
        shakeIntensity = shakeIntensity > 0 ? shakeIntensity - 1 : 0;
        if (shakeIntensity === 0) {
            clearInterval(shakeInterval);
            shaking = false;
        }
    }, 100);
}

function showRestartButton() {
    const restartButton = document.createElement('button');
    restartButton.innerText = 'Reiniciar';
    restartButton.style.position = 'absolute';
    restartButton.style.top = '50%';
    restartButton.style.left = '50%';
    restartButton.style.transform = 'translate(-50%, -50%)';
    restartButton.style.padding = '10px 20px';
    restartButton.style.fontSize = '16px';
    restartButton.style.cursor = 'pointer';
    restartButton.onclick = () => {
        socket.emit('restart');
        window.location.href = 'login.html';
    };
    document.body.appendChild(restartButton);
}

socket.on('update', data => {
    players = data.players;
    bullets = data.bullets;
    grenades = data.grenades;
    monsters = data.monsters;
    crystal = data.crystal;

    // Interpolar posição do jogador
    players.forEach(player => {
        if (player.id === socket.id) {
            const localPlayer = players.find(p => p.id === socket.id);
            if (localPlayer) {
                localPlayer.x = lerp(localPlayer.x, player.x, 0.1);
                localPlayer.y = lerp(localPlayer.y, player.y, 0.1);
                localPlayer.hp = player.hp;
                localPlayer.isActive = player.isActive;
            }
        }
    });

    // Desativar a tela se o jogador estiver inativo
    const localPlayer = players.find(p => p.id === socket.id);
    if (localPlayer && !localPlayer.isActive) {
        document.body.style.backgroundColor = 'gray';
        if (!document.getElementById('respawnCountdown')) {
            const countdownElement = document.createElement('div');
            countdownElement.id = 'respawnCountdown';
            countdownElement.style.position = 'absolute';
            countdownElement.style.top = '50%';
            countdownElement.style.left = '50%';
            countdownElement.style.transform = 'translate(-50%, -50%)';
            countdownElement.style.fontSize = '32px';
            countdownElement.style.color = 'white';
            document.body.appendChild(countdownElement);
            let countdown = 10;
            countdownElement.textContent = `Respawning in ${countdown}`;
            const interval = setInterval(() => {
                countdown--;
                countdownElement.textContent = `Respawning in ${countdown}`;
                if (countdown === 0) {
                    clearInterval(interval);
                    countdownElement.remove();
                    document.body.style.backgroundColor = '';
                    socket.emit('respawn');
                }
            }, 1000);
        }
    }
});

socket.on('reloadMessage', (playerId) => {
    const player = players.find(p => p.id === playerId);
    if (player) {
        reloadMessages.push({ x: player.x, y: player.y - 20, initialY: player.y - 20 });
    }
});

socket.on('updateScoreboard', scores => {
    playerScores = scores;
    console.log('Scoreboard updated:', scores); // Log para depuração
    updateScoreboard();
});

socket.on('crystalDestroyed', () => {
    startShaking();
    showRestartButton();
});

socket.on('restartGame', () => {
    window.location.href = 'login.html';
});

socket.on('updateMouse', ({ playerId, angle }) => {
    const player = players.find(p => p.id === playerId);
    if (player) {
        player.angle = angle;
    }
});

socket.on('shootSound', () => {
    shotSound.play(); // Reproduz o som do tiro
});

socket.on('deathSound', () => {
    const deathSound = deathSoundMonster[Math.floor(Math.random() * deathSoundMonster.length)];
    deathSound.play();
});

socket.on('reloadSound', () => {
    reloadSound.play(); // Reproduz o som de recarregamento
});

socket.on('reloadFala', () => {
    reloadFala.play(); // Reproduz o som de recarregamento Fala
});

socket.on('somDorAleatorio', () => {
    const somDorAleatorio = sonsDor[Math.floor(Math.random() * sonsDor.length)];
    somDorAleatorio.play();
});

socket.on('explosionSound', () => {
    explosionSound.play(); // Reproduz o som de explosão
});

socket.on('granadeFala', () => {
    granadeFala.play(); // Reproduz o som de explosão
});

socket.on('explosionParticles', ({ x, y }) => {
    createParticles(x, y);
});

socket.on('updateMonsterProgress', data => {
    const progressBar = document.getElementById('monsterProgressBar');
    progressBar.style.width = data.progress + '%';
    const progressText = document.getElementById('monsterProgressText');
    progressText.textContent = `${data.monstersLeft}/${data.monsterWaveSize}`;
});

socket.on('startNextWave', data => {
    backgroundImage.src = data.newBackground;
    const progressBar = document.getElementById('monsterProgressBar');
    progressBar.style.width = '100%';
});

canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    socket.emit('shoot', { x, y });
});

function lerp(a, b, t) {
    return a + (b - a) * t;
}

let particles = [];

function createParticles(x, y) {
    for (let i = 0; i < 20; i++) {
        particles.push({
            x: x,
            y: y,
            speedX: (Math.random() - 0.5) * 10,
            speedY: (Math.random() - 0.5) * 10,
            alpha: 1,
            radius: Math.random() * 5 + 2
        });
    }
}

function updateParticles() {
    particles = particles.filter(particle => particle.alpha > 0);
    particles.forEach(particle => {
        particle.x += particle.speedX;
        particle.y += particle.speedY;
        particle.alpha -= 0.02;
    });
}

function drawParticles(ctx) {
    particles.forEach(particle => {
        ctx.save();
        ctx.globalAlpha = particle.alpha;
        ctx.fillStyle = 'orange';
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });
}

draw();
