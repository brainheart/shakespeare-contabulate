PY=python3
BUILD_SCRIPT=build.py
TEI_DIR=tei
PUBLIC_DIR=public
DATA_DIR=$(PUBLIC_DIR)/data
LINES_DIR=$(PUBLIC_DIR)/lines

.PHONY: all build clean regenerate

all: build

build:
	@echo "[build] Generating JSON data from $(TEI_DIR) -> $(DATA_DIR)"
	$(PY) $(BUILD_SCRIPT)
	@echo "[build] Done."

clean:
	@echo "[clean] Removing generated data directories $(DATA_DIR) and $(LINES_DIR)"
	rm -rf $(DATA_DIR) $(LINES_DIR)
	@echo "[clean] Done."

regenerate: clean build
	@echo "[regenerate] Complete."
