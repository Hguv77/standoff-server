const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

let players = {};
let bullets = [];
let nextId = 1;

const WEAPONS = [
    { id: 'pistol', name: 'Пистолет', damage: 25, fireRate: 0.22, magSize: 12, reloadTime: 1.2, auto: false, icon: '🔫', price: 0 },
    { id: 'ak', name: 'Автомат', damage: 20, fireRate: 0.09, magSize: 30, reloadTime: 2.0, auto: true, icon: '🔫', price: 500 },
    { id: 'shotgun', name: 'Дробовик', damage: 40, fireRate: 0.45, magSize: 6, reloadTime: 2.5, auto: false, spread: 0.08, icon: '💥', price: 800 },
    { id: 'sniper', name: 'Снайперка', damage: 90, fireRate: 0.8, magSize: 5, reloadTime: 3.0, auto: false, spread: 0.005, icon: '🎯', price: 1200 },
    { id: 'smg', name: 'ПП-2000', damage: 18, fireRate: 0.06, magSize: 25, reloadTime: 1.8, auto: true, icon: '🔫', price: 600 },
    { id: 'lmg', name: 'Пулемёт', damage: 12, fireRate: 0.05, magSize: 60, reloadTime: 3.5, auto: true, icon: '🔫', price: 1000 },
    { id: 'revolver', name: 'Револьвер', damage: 35, fireRate: 0.5, magSize: 6, reloadTime: 2.0, auto: false, icon: '💥', price: 700 }
];

function getRandomSpawn() {
    const mapSize = 120;
    const half = mapSize/2 - 5;
    return { x: (Math.random() - 0.5) * 2 * half, z: (Math.random() - 0.5) * 2 * half };
}

const MAX_MOVE_SPEED = 10;
const MAX_HIT_DISTANCE = 60;

wss.on('connection', (ws) => {
    const id = nextId++;
    const spawn = getRandomSpawn();
    players[id] = {
        id, x: spawn.x, y: 1.7, z: spawn.z, rotY: 0, rotX: 0,
        health: 100, ammo: 12, currentWeapon: 0, inventory: ['pistol'],
        money: 1000, kills: 0, score: 0, isCrouching: false, isJumping: false,
        isGrounded: true, velocityY: 0, weapon: WEAPONS[0],
        lastShootTime: 0, lastMoveTime: Date.now()
    };

    ws.send(JSON.stringify({ type: 'init', id, players, weapons: WEAPONS }));
    broadcast(JSON.stringify({ type: 'state', players, bullets }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const now = Date.now();
            const deltaTime = (now - (players[id]?.lastMoveTime || now)) / 1000;

            switch (data.type) {
                case 'move': {
                    if (!players[id]) break;
                    const dx = data.x - players[id].x;
                    const dz = data.z - players[id].z;
                    const dist = Math.sqrt(dx*dx + dz*dz);
                    if (dist <= MAX_MOVE_SPEED * deltaTime) {
                        players[id].x = data.x;
                        players[id].y = data.y;
                        players[id].z = data.z;
                        players[id].rotY = data.rotY;
                        players[id].rotX = data.rotX;
                        players[id].isGrounded = data.isGrounded;
                        players[id].velocityY = data.velocityY;
                        players[id].isCrouching = data.isCrouching;
                        players[id].lastMoveTime = now;
                    }
                    break;
                }
                case 'shoot': {
                    if (!players[id]) break;
                    const weapon = players[id].weapon;
                    if (players[id].ammo <= 0) break;
                    if (now - players[id].lastShootTime < weapon.fireRate * 1000) break;
                    players[id].ammo--;
                    const bullet = {
                        id: Date.now() + Math.random(),
                        owner: id,
                        x: data.x, y: data.y, z: data.z,
                        dx: data.dx, dy: data.dy, dz: data.dz,
                        damage: weapon.damage
                    };
                    bullets.push(bullet);
                    broadcast(JSON.stringify({ type: 'shoot', bullet }));
                    players[id].lastShootTime = now;
                    setTimeout(() => { bullets = bullets.filter(b => b.id !== bullet.id); }, 3000);
                    break;
                }
                case 'hit': {
                    if (!players[id]) break;
                    const victim = players[data.victimId];
                    if (!victim) break;
                    const shooterPos = players[id];
                    const dx = shooterPos.x - victim.x;
                    const dz = shooterPos.z - victim.z;
                    if (Math.sqrt(dx*dx + dz*dz) > MAX_HIT_DISTANCE) break;
                    const maxDamage = players[id].weapon.damage;
                    const damage = Math.min(data.damage, maxDamage);
                    victim.health -= damage;
                    if (victim.health <= 0) {
                        victim.health = 0;
                        players[id].kills = (players[id].kills || 0) + 1;
                        players[id].score = (players[id].score || 0) + 10;
                        setTimeout(() => {
                            const spawn = getRandomSpawn();
                            victim.x = spawn.x;
                            victim.y = 1.7;
                            victim.z = spawn.z;
                            victim.health = 100;
                            victim.ammo = 12;
                            victim.isGrounded = true;
                            victim.velocityY = 0;
                            broadcast(JSON.stringify({ type: 'respawn', id: victim.id }));
                        }, 3000);
                    }
                    broadcast(JSON.stringify({ type: 'state', players, bullets }));
                    break;
                }
                case 'reload': {
                    if (!players[id]) break;
                    players[id].ammo = players[id].weapon.magSize;
                    broadcast(JSON.stringify({ type: 'state', players, bullets }));
                    break;
                }
                case 'switch_weapon': {
                    if (!players[id]) break;
                    const idx = data.index;
                    if (idx >= 0 && idx < players[id].inventory.length) {
                        const wId = players[id].inventory[idx];
                        const weapon = WEAPONS.find(w => w.id === wId);
                        if (weapon) {
                            players[id].currentWeapon = idx;
                            players[id].weapon = weapon;
                            players[id].ammo = weapon.magSize;
                            broadcast(JSON.stringify({ type: 'state', players, bullets }));
                        }
                    }
                    break;
                }
                case 'buy_weapon': {
                    if (!players[id]) break;
                    const weaponId = data.weaponId;
                    const weapon = WEAPONS.find(w => w.id === weaponId);
                    if (weapon && players[id].money >= weapon.price && !players[id].inventory.includes(weaponId)) {
                        players[id].money -= weapon.price;
                        players[id].inventory.push(weaponId);
                        if (players[id].inventory.length === 1) {
                            players[id].currentWeapon = 0;
                            players[id].weapon = weapon;
                            players[id].ammo = weapon.magSize;
                        }
                        broadcast(JSON.stringify({ type: 'state', players, bullets }));
                    }
                    break;
                }
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        delete players[id];
        broadcast(JSON.stringify({ type: 'state', players, bullets }));
    });
});

function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

setInterval(() => {
    const now = Date.now();
    bullets = bullets.filter(b => now - b.id < 5000);
}, 5000);

console.log('Сервер с защитой запущен на порту ' + (process.env.PORT || 8080));
