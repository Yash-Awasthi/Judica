module.exports = {
  apps: [{
    name: 'aibyai-server',
    script: 'dist/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env_production: { NODE_ENV: 'production' },
    max_memory_restart: '512M'
  }]
};
