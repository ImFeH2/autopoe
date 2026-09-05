set -eu

mode=$1
component=$2
check=false
case "$mode" in
    check-*) check=true; mode=${mode#check-} ;;
esac

fail() {
    if [ "$check" = true ]; then
        printf '%s\n' "$1"
    else
        printf '%s\n' "$1" >&2
    fi
    exit 1
}

if ! command -v bwrap >/dev/null 2>&1; then
    fail 'WSL backend requires bubblewrap'
fi

case "$mode" in
    development)
        uv=$(command -v uv || true)
        if [ -z "$uv" ] && [ -x "$HOME/.local/bin/uv" ]; then
            uv=$HOME/.local/bin/uv
        fi
        if [ -z "$uv" ]; then
            fail 'WSL development requires uv'
        fi
        if [ "$check" = true ]; then exit 0; fi
        exec "$uv" run --isolated --frozen --project "$component" python -m huddol
        ;;
    bundled)
        for tool in tar sha256sum mktemp; do
            if ! command -v "$tool" >/dev/null 2>&1; then
                fail "WSL backend requires $tool"
            fi
        done
        if [ "$check" = true ]; then exit 0; fi
        digest=$(sha256sum "$component")
        digest=${digest%% *}
        base=${XDG_CACHE_HOME:-"$HOME/.cache"}/huddol/backends
        target=$base/$digest
        if [ ! -x "$target/huddol" ]; then
            mkdir -p "$base"
            stage=$(mktemp -d "$base/.stage-XXXXXX")
            trap 'rm -rf -- "$stage"' EXIT
            tar -xf "$component" -C "$stage"
            test -f "$stage/huddol"
            chmod u+x "$stage/huddol"
            if ! mv -T "$stage" "$target"; then
                test -x "$target/huddol"
            fi
            rm -rf -- "$stage"
            trap - EXIT
        fi
        exec "$target/huddol"
        ;;
    *)
        printf '%s\n' 'Unknown backend component mode' >&2
        exit 1
        ;;
esac
