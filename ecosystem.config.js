module.exports = {
  apps: [
    {
      name: 'wa-status',
      script: './index.js',
      node_args: '--expose-gc --max-old-space-size=256',
      max_memory_restart: '280M',
      autorestart: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};