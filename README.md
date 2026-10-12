# 🌐 Bangladesh Family Card & Voter Management System

Ultra-low latency web application for managing Voter Lists and National Family Cards (ফতেপুর ইউনিয়ন, রাজনগর, মৌলভীবাজার).

---

## 📁 Repository Structure

```
.
├── server.py             # High-performance FastAPI backend (WAL + MMAP + FTS5)
├── requirements.txt      # Python dependencies (FastAPI, Uvicorn, Pydantic)
├── render.yaml           # 1-Click Render.com deployment Blueprint
├── Dockerfile            # Container definition for Hugging Face Spaces or Docker
├── metrics_cache.json    # Precomputed analytics cache
├── voters.db.gz          # Compressed voter database (auto-extracted on first launch)
├── .gitignore            # Git ignore file
└── static/               # Frontend UI assets
    ├── index.html        # Clean modern dashboard with individual Ward filters (W 1 - W 9)
    ├── style.css         # Minimalist responsive design system
    └── app.js            # Fast SWR cached frontend logic
```

---

## 🚀 Free Deployment Guide

### Option 1: Render.com (Recommended - 100% Free Web Service)
1. Push this folder to your GitHub repository (e.g., `family-card-system`).
2. Go to [Render.com](https://render.com) and click **New** -> **Web Service**.
3. Connect your GitHub repository.
4. Render will automatically detect `render.yaml`, or use these settings:
   - **Environment:** `Python 3`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn server:app --host 0.0.0.0 --port $PORT`
5. Click **Create Web Service**. Your free live URL will be ready in 1–2 minutes!

### Option 2: Hugging Face Spaces (Free Forever)
1. Create a new Space at [huggingface.co/spaces](https://huggingface.co/spaces).
2. Choose **Docker** as Space SDK.
3. Push/upload these files to your Space repository.
4. The app will build automatically and run 24/7 on port 7860.

---

## 💻 Local Running Instructions

```bash
# 1. Install requirements
pip install -r requirements.txt

# 2. Run with Uvicorn
uvicorn server:app --host 127.0.0.1 --port 8000
```

Open your browser at `http://127.0.0.1:8000`.
