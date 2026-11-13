@echo off
setlocal
set FLUX=E:\TOOLS\FLUX3-MCP\bin\flux-image.cmd
cd /d "%~dp0.."

echo === paper ===
call "%FLUX%" generate --prompt-file assets\prompts\paper.txt  --width 1024 --height 1024 --steps 12 --wait --out assets\images\paper.png
echo === title ===
call "%FLUX%" generate --prompt-file assets\prompts\title.txt  --width 1024 --height 576  --steps 12 --wait --out assets\images\title.png
echo === ghosts ===
call "%FLUX%" generate --prompt-file assets\prompts\ghosts.txt --width 1024 --height 256  --steps 12 --wait --out assets\images\ghosts.png
echo ALL DONE
