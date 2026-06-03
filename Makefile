.DEFAULT_GOAL := help

ROOT_DIR := $(CURDIR)
MODS_SRC := $(ROOT_DIR)/mods

BALATRO_SAVE ?= $(HOME)/Library/Application Support/Balatro
BALATRO_DIR ?= $(HOME)/Library/Application Support/Steam/steamapps/common/Balatro
BALATRO_APP ?= $(BALATRO_DIR)/Balatro.app

MODS_DIR := $(BALATRO_SAVE)/Mods
SMODS_DIR := $(MODS_DIR)/smods
LOVE_BIN := $(BALATRO_APP)/Contents/MacOS/love
LOVELY_DYLIB := $(BALATRO_DIR)/liblovely.dylib
LOVELY_RUN := $(BALATRO_DIR)/run_lovely_macos.sh

.PHONY: help doctor install-mods run

help:
	@printf 'Balatro MCP development workflow\n\n'
	@printf 'Targets:\n'
	@printf '  make doctor        Check local Balatro/Lovely/SMODS paths\n'
	@printf '  make install-mods  Sync repo mods into the Balatro Mods directory\n'
	@printf '  make run           Sync mods, then launch Balatro with Lovely\n'
	@printf '\nConfiguration:\n'
	@printf '  BALATRO_DIR=%s\n' '$(BALATRO_DIR)'
	@printf '  BALATRO_SAVE=%s\n' '$(BALATRO_SAVE)'
	@printf '  ARGS="..." passes arguments to make run\n'

install-mods:
	@bash -eu -o pipefail -c ' \
		if [[ ! -d "$(MODS_SRC)" ]]; then \
			printf "No repo mods directory found: %s\n" "$(MODS_SRC)" >&2; \
			exit 1; \
		fi; \
		mkdir -p "$(MODS_DIR)"; \
		shopt -s nullglob; \
		synced=0; \
		for src in "$(MODS_SRC)"/*; do \
			[[ -d "$$src" ]] || continue; \
			name="$$(basename "$$src")"; \
			if [[ "$$name" == "smods" ]]; then \
				printf "Skipping reserved mod name: %s\n" "$$name" >&2; \
				continue; \
			fi; \
			dst="$(MODS_DIR)/$$name"; \
			mkdir -p "$$dst"; \
			rm -f "$$dst/actions.lua" "$$dst/commands.lua" "$$dst/state.lua"; \
			rsync -a --delete --exclude bridge/ "$$src"/ "$$dst"/; \
			printf "Installed mod %s -> %s\n" "$$name" "$$dst"; \
			synced=$$((synced + 1)); \
		done; \
		if [[ "$$synced" -eq 0 ]]; then \
			printf "No mods to install from %s\n" "$(MODS_SRC)"; \
		else \
			printf "Installed %d mod(s).\n" "$$synced"; \
		fi \
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
		printf "\nRepo mods:\n"; \
		shopt -s nullglob; \
		mods=("$(MODS_SRC)"/*); \
		if (( $${#mods[@]} == 0 )); then \
			printf "none\n"; \
		else \
			for mod in "$${mods[@]}"; do \
				[[ -d "$$mod" ]] && printf "repo mod %s\n" "$$(basename "$$mod")"; \
			done; \
		fi \
	'

run: install-mods
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
		export DYLD_INSERT_LIBRARIES="$(LOVELY_DYLIB)"; \
		exec "$(LOVE_BIN)" $(ARGS) \
	'
