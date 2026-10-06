.PHONY: install frontend build handover-check

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

handover-check:
	sh scripts/handover-check.sh
