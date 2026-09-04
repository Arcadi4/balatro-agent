.DEFAULT_GOAL := help

ROOT_DIR := $(CURDIR)
MOD_SRC := $(ROOT_DIR)/mod
MCP_DIR := $(ROOT_DIR)/mcp
MCP_ENTRY := $(MCP_DIR)/dist/index.js

BALATRO_SAVE ?= $(HOME)/Library/Application Support/Balatro
BALATRO_DIR ?= $(HOME)/Library/Application Support/Steam/steamapps/common/Balatro
BALATRO_APP ?= $(BALATRO_DIR)/Balatro.app

MODS_DIR := $(BALATRO_SAVE)/Mods
MOD_DST := $(MODS_DIR)/balatro-agent
SMODS_DIR := $(MODS_DIR)/smods
LOVE_BIN := $(BALATRO_APP)/Contents/MacOS/love
LOVELY_DYLIB := $(BALATRO_DIR)/liblovely.dylib
LOVELY_RUN := $(BALATRO_DIR)/run_lovely_macos.sh

.PHONY: help doctor install-mods build-mcp run

help:
	@printf 'Balatro MCP development workflow\n\n'
	@printf 'Targets:\n'
	@printf '  make doctor        Check local Balatro/Lovely/SMODS paths\n'
	@printf '  make install-mods  Sync the repo mod into the Balatro Mods directory\n'
	@printf '  make build-mcp     Install MCP dependencies and build the local server\n'
	@printf '  make run           Build the MCP server, sync the mod and launch Balatro\n'
	@printf '\nConfiguration:\n'
	@printf '  BALATRO_DIR=%s\n' '$(BALATRO_DIR)'
	@printf '  BALATRO_SAVE=%s\n' '$(BALATRO_SAVE)'
	@printf '  ARGS="..." passes arguments to make run\n'
install-mods:
	@bash -eu -o pipefail -c ' \
		if [[ ! -d "$(MOD_SRC)" ]]; then \
			printf "No repo mod directory found: %s\n" "$(MOD_SRC)" >&2; \
			exit 1; \
		fi; \
		mkdir -p "$(MOD_DST)"; \
		rm -f "$(MOD_DST)/actions.lua" "$(MOD_DST)/commands.lua" "$(MOD_DST)/state.lua"; \
		rsync -a --delete --exclude bridge/ "$(MOD_SRC)"/ "$(MOD_DST)"/; \
		printf "Installed mod -> %s\n" "$(MOD_DST)"; \
	'

doctor:
	@bash -eu -o pipefail -c ' \
		check_path() { \
			local kind="$$1"; \
			local path="$$2"; \
			if [[ "$$kind" == dir && -d "$$path" ]]; then \
				printf "ok dir  %s\n" "$$path"; \
			elif [[ "$$kind" == file && -f "$$path" ]]; then \
				printf "ok file %s\n" "$$path"; \
			else \
				printf "missing %s %s\n" "$$kind" "$$path" >&2; \
				return 1; \
			fi; \
		}; \
		printf "Balatro mod development environment\n"; \
		printf "Repo: %s\n" "$(ROOT_DIR)"; \
		printf "BALATRO_DIR: %s\n" "$(BALATRO_DIR)"; \
		printf "BALATRO_APP: %s\n" "$(BALATRO_APP)"; \
		printf "BALATRO_SAVE: %s\n\n" "$(BALATRO_SAVE)"; \
		check_path dir "$(BALATRO_APP)"; \
		check_path dir "$(BALATRO_APP)/Contents/MacOS"; \
		check_path file "$(LOVE_BIN)"; \
		check_path file "$(LOVELY_DYLIB)"; \
		check_path file "$(LOVELY_RUN)"; \
		check_path file "$(BALATRO_APP)/Contents/Resources/Balatro.love"; \
		check_path dir "$(BALATRO_SAVE)"; \
		check_path dir "$(MODS_DIR)"; \
		check_path dir "$(SMODS_DIR)"; \
		check_path file "$(SMODS_DIR)/manifest.json"; \
		printf "\nRepo mod:\n"; \
		if [[ -d "$(MOD_SRC)" ]]; then \
			printf "repo mod %s\n" "$$(basename "$(MOD_SRC)")"; \
		else \
			printf "none\n"; \
		fi \
	'

build-mcp:
	@bash -eu -o pipefail -c ' \
		cd "$(MCP_DIR)"; \
		bun install; \
		bun run build; \
	'

run: build-mcp install-mods
	@bash -eu -o pipefail -c ' \
		if [[ ! -x "$(LOVE_BIN)" ]]; then \
			printf "Balatro love executable is missing or not executable: %s\n" "$(LOVE_BIN)" >&2; \
			exit 1; \
		fi; \
		if [[ ! -f "$(LOVELY_DYLIB)" ]]; then \
			printf "Lovely dylib is missing: %s\n" "$(LOVELY_DYLIB)" >&2; \
			exit 1; \
		fi; \
		cd "$(BALATRO_DIR)"; \
		BALATRO_MCP_ENTRY="$(MCP_ENTRY)" DYLD_INSERT_LIBRARIES="$(LOVELY_DYLIB)" "$(LOVE_BIN)" $(ARGS) \
	'
