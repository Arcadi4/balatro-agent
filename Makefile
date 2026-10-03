.DEFAULT_GOAL := help

ROOT_DIR := $(CURDIR)
MOD_SRC := $(ROOT_DIR)/mod

BALATRO_SAVE ?= $(HOME)/Library/Application Support/Balatro
BALATRO_DIR ?= $(HOME)/Library/Application Support/Steam/steamapps/common/Balatro
BALATRO_APP ?= $(BALATRO_DIR)/Balatro.app

ifeq ($(firstword $(MAKECMDGOALS)),bump)
  BUMP_ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
  LEVEL ?= $(if $(VERSION),$(VERSION),$(if $(BUMP_ARGS),$(BUMP_ARGS),patch))
  $(eval $(BUMP_ARGS):;@:)
endif
LEVEL ?= $(if $(VERSION),$(VERSION),patch)

MODS_DIR := $(BALATRO_SAVE)/Mods
MOD_DST := $(MODS_DIR)/balatro-agent
SMODS_DIR := $(MODS_DIR)/smods
LOVE_BIN := $(BALATRO_APP)/Contents/MacOS/love
LOVELY_DYLIB := $(BALATRO_DIR)/liblovely.dylib
LOVELY_RUN := $(BALATRO_DIR)/run_lovely_macos.sh

.PHONY: help doctor install-mods run bump

help:
	@printf 'Balatro MCP development workflow\n\n'
	@printf 'Targets:\n'
	@printf '  make doctor        Check local Balatro/Lovely/SMODS paths\n'
	@printf '  make install-mods  Sync the repo mod into the Balatro Mods directory\n'
	@printf '  make run           Sync the mod, then launch Balatro with Lovely\n'
	@printf '  make bump          Bump major, minor, or patch (default: patch), then commit and tag\n'
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

# Tags a release: bump the version, commit, and tag.
#
# Takes the component to raise, so the current version never has to be looked
# up: a bare `make bump` and `make bump patch` both raise patch, `make bump minor`
# raises minor, and `make bump major` raises major. Runs only on main from a
# clean workspace, so the tag always names exactly what was reviewed. Push the
# commit and the tag yourself; the release workflow fires on the tag.
bump:
	@bash -eu -o pipefail -c ' \
		level="$(LEVEL)"; \
		branch=$$(git branch --show-current); \
		if [[ "$$branch" != "main" ]]; then \
			echo "bump: versions are cut from main, not $$branch" >&2; \
			exit 1; \
		fi; \
		if [[ -n "$$(git status --porcelain)" ]]; then \
			echo "bump: workspace has uncommitted changes:" >&2; \
			git status --short >&2; \
			exit 1; \
		fi; \
		mod_version=$$(sed -nE "s/^[[:space:]]*\"version\":[[:space:]]*\"([0-9]+\.[0-9]+\.[0-9]+)\".*/\1/p" mod/manifest.json); \
		if [[ -z "$$mod_version" ]]; then \
			echo "bump: no version found in mod/manifest.json" >&2; \
			exit 1; \
		fi; \
		mcp_version=$$(sed -nE "s/^[[:space:]]*\"version\":[[:space:]]*\"([0-9]+\.[0-9]+\.[0-9]+)\".*/\1/p" mcp/package.json); \
		if [[ -z "$$mcp_version" ]]; then \
			echo "bump: no version found in mcp/package.json" >&2; \
			exit 1; \
		fi; \
		if [[ "$$mod_version" != "$$mcp_version" ]]; then \
			echo "bump: versions are out of sync: mod=$$mod_version mcp=$$mcp_version" >&2; \
			exit 1; \
		fi; \
		current="$$mod_version"; \
		case "$$level" in \
			major) next=$$(awk -F. "{ printf \"%d.0.0\", \$$1 + 1 }" <<<"$$current") ;; \
			minor) next=$$(awk -F. "{ printf \"%d.%d.0\", \$$1, \$$2 + 1 }" <<<"$$current") ;; \
			patch) next=$$(awk -F. "{ printf \"%d.%d.%d\", \$$1, \$$2, \$$3 + 1 }" <<<"$$current") ;; \
			*) \
				echo "usage: make bump [major|minor|patch]" >&2; \
				exit 1; \
				;; \
		esac; \
		if git rev-parse -q --verify "refs/tags/v$$next" >/dev/null; then \
			echo "bump: tag v$$next already exists" >&2; \
			exit 1; \
		fi; \
		sed -i.bak -E "s/^([[:space:]]*\"version\":[[:space:]]*\")[^\"]+/\1$$next/" mod/manifest.json mcp/package.json; \
		rm -f mod/manifest.json.bak mcp/package.json.bak; \
		grep -q "\"version\": \"$$next\"" mod/manifest.json; \
		grep -q "\"version\": \"$$next\"" mcp/package.json; \
		changed=$$(git diff --name-only | LC_ALL=C sort); \
		expected=$$(printf "%s\n%s" "mcp/package.json" "mod/manifest.json" | LC_ALL=C sort); \
		if [[ "$$changed" != "$$expected" ]]; then \
			echo "bump: refusing to commit changes beyond the version bump:" >&2; \
			git status --short >&2; \
			exit 1; \
		fi; \
		git add mod/manifest.json mcp/package.json; \
		git commit -m "chore: bump to v$$next"; \
		git tag -a "v$$next" -m "v$$next"; \
		echo "bumped $$current to $$next, committed and tagged v$$next"; \
		echo "publish with: git push origin main v$$next"; \
	'
