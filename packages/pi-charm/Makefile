GO ?= go
GOFMT ?= gofmt

.PHONY: fmt fmt-check lint vet test check

fmt:
	$(GOFMT) -w .

fmt-check:
	@unformatted="$$( $(GOFMT) -l . )"; \
	if [ -n "$$unformatted" ]; then \
		echo "Unformatted Go files:"; \
		printf '%s\n' "$$unformatted"; \
		exit 1; \
	fi

lint: vet

vet:
	$(GO) vet ./...

test:
	$(GO) test ./...

check: fmt-check lint test
