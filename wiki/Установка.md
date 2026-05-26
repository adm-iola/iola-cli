# Installation

## Требования

Нужен Node.js `22.5.0` или новее:

```bash
node --version
npm --version
```

Установка Node.js:

```bash
# Windows
winget install OpenJS.NodeJS.LTS

# macOS
brew install node

# Linux
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## Установка CLI

```bash
npm install -g @iola_adm/iola-cli
iola --help
```

Без глобальной установки:

```bash
npx -y @iola_adm/iola-cli init
```

## Ollama для локальной модели

```bash
# Windows
winget install Ollama.Ollama

# macOS
brew install --cask ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

Проверка:

```bash
ollama --version
iola ai doctor
iola ai setup ollama
```
