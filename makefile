PLUGIN_NAME ?=
PLUGIN_DIR = plugins/$(PLUGIN_NAME)
PLUGIN_ENTRY = $(PLUGIN_DIR)/src/index.ts
PLUGIN_DIST_DIR = dist/plugins/$(PLUGIN_NAME)/src
PLUGIN_DIST_FILE = $(PLUGIN_DIST_DIR)/index.js

.PHONY: help build-% build-all list-plugins

help:
	@printf '%s\n' \
		'make build-<plugin>    Build a plugin entry into dist/plugins/<plugin>/src/index.js' \
		'make build-all         Build all plugins under plugins/' \
		'make list-plugins      List available plugin names'

list-plugins:
	@find plugins -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort

build-%:
	@$(MAKE) PLUGIN_NAME=$* __build_plugin

build-all:
	@set -e; \
	for plugin in $$(find plugins -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort); do \
		$(MAKE) build-$$plugin; \
	done

.PHONY: __build_plugin
__build_plugin:
	@if [ -z "$(PLUGIN_NAME)" ]; then \
		echo "PLUGIN_NAME is required."; \
		exit 1; \
	fi
	@if [ ! -d "$(PLUGIN_DIR)" ]; then \
		echo "Unknown plugin: $(PLUGIN_NAME)"; \
		exit 1; \
	fi
	@if [ ! -f "$(PLUGIN_ENTRY)" ]; then \
		echo "Missing plugin entry: $(PLUGIN_ENTRY)"; \
		exit 1; \
	fi
	@mkdir -p "$(PLUGIN_DIST_DIR)"
	@bun build "$(PLUGIN_ENTRY)" --outdir "$(PLUGIN_DIST_DIR)" --target bun --format esm
	@echo "Built $(PLUGIN_NAME) -> $(PLUGIN_DIST_FILE)"
