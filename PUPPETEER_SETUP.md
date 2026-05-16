# Production Environment Setup for Puppeteer/Chromium

## Overview
This backend uses `puppeteer-core` which does NOT auto-download Chromium. 
You must provide an external Chrome/Chromium executable at runtime.

## Configuration

### Option 1: Environment Variable (Recommended)
Set `PUPPETEER_EXECUTABLE_PATH` before running the executable:

**Windows (PowerShell):**
```powershell
$env:PUPPETEER_EXECUTABLE_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
.\dist\inboxguaranteed-backend.exe
```

**Windows (CMD):**
```cmd
set PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
dist\inboxguaranteed-backend.exe
```

**Linux/macOS:**
```bash
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
./dist/inboxguaranteed-backend
```

### Option 2: .env File
Add to `.env`:
```
PUPPETEER_EXECUTABLE_PATH=/path/to/chromium
```

## Chrome/Chromium Installation

### Windows
- **Google Chrome**: Already installed in `C:\Program Files\Google\Chrome\Application\chrome.exe`
- **Chromium**: Download from https://download-chromium.appspot.com/

### Linux (Ubuntu/Debian)
```bash
sudo apt-get install chromium-browser
# Or
sudo apt-get install google-chrome-stable
```

### macOS
```bash
brew install --cask google-chrome
# Or
brew install --cask chromium
```

## Deployment Checklist

- [ ] `puppeteer-core` is installed (no Chromium bundled)
- [ ] `.pkgignore` excludes `.local-chromium/**`
- [ ] Build completes without Puppeteer warnings
- [ ] Chrome/Chromium is installed on target system
- [ ] `PUPPETEER_EXECUTABLE_PATH` environment variable is set
- [ ] Run executable under appropriate user permissions
- [ ] Test PDF generation (if used): `curl http://localhost:PORT/api/pdf-endpoint`

## Build Output Verification

After running `npm run build`:
- Executable: `dist/inboxguaranteed-backend.exe`
- Size: Should be significantly smaller (no Chromium bulk)
- Warnings: Should NOT mention "puppeteer/.local-chromium"
- Only remaining warnings should be `strnum.js` bytecode (non-critical)

## Testing

```bash
# Start the backend
npm start

# Or use the built executable
./dist/inboxguaranteed-backend.exe

# Test health endpoint
curl http://localhost:3000/health
```

## Troubleshooting

### Error: "Failed to launch chrome/chromium"
- Verify Chrome/Chromium is installed
- Check `PUPPETEER_EXECUTABLE_PATH` points to correct binary
- Verify permissions to execute the binary

### Error: "Chromium not found"
- Install Chromium using platform-specific instructions above
- Set environment variable before running executable

### Performance Issues
- Ensure Chrome/Chromium is up-to-date
- Check system resources (RAM, CPU)
- Consider using headless: `true` in puppeteer launch options
