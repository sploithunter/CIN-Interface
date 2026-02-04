# CIN-Interface Deployment Guide

## Quick Deploy (Render.com)

### Prerequisites
- GitHub account with access to `sploithunter/CIN-Interface`
- Render.com account (https://render.com)

### Steps

1. **Go to Render Dashboard**
   - https://dashboard.render.com

2. **Create Web Service**
   - Click "New +" → "Web Service"
   - Select repository: `sploithunter/CIN-Interface`
   - Connect GitHub if prompted

3. **Configure Service**
   - **Name**: `cin-interface`
   - **Environment**: Docker
   - **Region**: `oregon` (or `us-east-1`)
   - **Plan**: Standard
   - **Build Command**: (leave empty - uses Dockerfile)
   - **Start Command**: (leave empty - uses Dockerfile)

4. **Environment Variables**
   - `NODE_ENV` = `production`
   - `PORT` = `3000`
   - `HOST` = `0.0.0.0`

5. **Deploy**
   - Click "Create Web Service"
   - Wait 5-10 minutes for build and deploy
   - Get your URL from the dashboard (e.g., `https://cin-interface.onrender.com`)

### Health Check
Once deployed, verify at: `https://cin-interface.onrender.com/health`

Should return:
```json
{
  "status": "ok",
  "uptime": 123456,
  "version": "0.1.0"
}
```

---

## Local Development

### Prerequisites
- Node.js 22+
- npm 10+
- coding-agent-bridge installed locally

### Install & Build
```bash
npm install
npm link /path/to/coding-agent-bridge
npm run build
```

### Run
```bash
# Development mode (client + server with hot reload)
npm run dev

# Production mode
npm start
```

Visit http://localhost:3000

---

## Docker (Local)

### Build
```bash
docker build -t cin-interface .
```

### Run
```bash
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -v cin-data:/app/data \
  cin-interface
```

Visit http://localhost:3000

---

## Configuration

### Environment Variables
- `NODE_ENV` - `development` or `production`
- `PORT` - Server port (default: 3000)
- `HOST` - Bind address (default: localhost)
- `DEEPGRAM_API_KEY` - For voice transcription (optional)

### Data Persistence
- Mounted at `/app/data` (Docker) or `./data` (local)
- Stores session files, feedback, and project data

---

## Troubleshooting

### Health Check Fails
```bash
# Check server is running
curl http://localhost:3000/health

# Check logs (Render)
# Go to dashboard → cin-interface → Logs
```

### Build Fails
```bash
# Ensure coding-agent-bridge is available
npm link /path/to/coding-agent-bridge

# Clear cache and rebuild
rm -rf node_modules dist
npm install
npm run build
```

### Port Already in Use
```bash
# Use different port
PORT=3001 npm start
```

---

## Deployment Status

✅ **Code Ready**: Docker & render.yaml configured
✅ **Build**: `npm run build` succeeds
✅ **Health Check**: `/health` endpoint active
⏳ **Deployment**: Push to main → Render auto-deploys
