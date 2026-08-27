from huddol.mentions import (
    MentionName,
    find_mentions,
    mention_name_issues,
    normalized_mention_name,
)


def refs(body: str, *names: tuple[int, str]) -> list[tuple[int, int, int]]:
    return [
        (item.member_id, item.start, item.end)
        for item in find_mentions(body, (MentionName(*name) for name in names))
    ]


def test_matches_nfkc_casefold_names_and_preserves_unicode_offsets() -> None:
    body = "请找 @ＡＤＡ 和 @Straße，再找 @Ada 与 @E\u0301lodie。"
    found = refs(body, (2, "ADA"), (3, "STRASSE"), (4, "Élodie"))
    assert [body[start:end] for _, start, end in found] == [
        "@ＡＤＡ",
        "@Straße",
        "@Ada",
        "@E\u0301lodie",
    ]
    assert [member_id for member_id, _, _ in found] == [2, 3, 2, 4]
    assert normalized_mention_name("Ａda") == "ada"


def test_excludes_sender_by_stable_member_id_before_parsing() -> None:
    names = (MentionName(1, "Renamed-Owner"), MentionName(2, "Owner"))

    occurrences = find_mentions(
        "@Renamed-Owner asks @Owner",
        names,
        excluded_member_ids=(1,),
    )
    assert [(item.member_id, item.start, item.end) for item in occurrences] == [
        (2, 20, 26)
    ]


def test_requires_complete_hyphen_and_underscore_tokens_with_longest_name() -> None:
    body = "@Ada-Lovelace, @Ada, @AdaX, @Ada_2, @Ada-foo"
    assert refs(
        body,
        (2, "Ada"),
        (3, "Ada-Lovelace"),
        (4, "Ada_2"),
    ) == [(3, 0, 13), (2, 15, 19), (4, 28, 34)]


def test_matches_names_at_the_new_maximum_without_a_parser_side_limit() -> None:
    name = "𐐀" * 32
    body = f"Ask @{name} now"
    assert refs(body, (2, name)) == [(2, 4, 37)]


def test_excludes_email_generic_urls_and_code() -> None:
    body = (
        "ada@example.com https://example.com/@Ada mailto:Ada@example.com "
        "custom+git:@Ada www.example.com/@Ada `@Ada`\n```py\n@Ada\n```\n@Ada"
    )
    found = refs(body, (2, "Ada"))
    assert found == [(2, body.rfind("@Ada"), len(body))]


def test_fenced_code_closes_only_when_marker_is_followed_by_whitespace() -> None:
    trailing_text = "```txt\n```not-close\n@Ada\n```"
    assert refs(trailing_text, (2, "Ada")) == []

    tab_and_text = "```txt\n```\tstill-not-close\n@Ada\n```"
    assert refs(tab_and_text, (2, "Ada")) == []

    valid_close = "```txt\ninside\n``` \t\n@Ada"
    assert refs(valid_close, (2, "Ada")) == [
        (2, valid_close.rfind("@Ada"), len(valid_close))
    ]

    tilde_trailing_text = "~~~txt\n~~~~not-close\n@Ada\n~~~"
    assert refs(tilde_trailing_text, (2, "Ada")) == []

    valid_tilde_close = "~~~txt\ninside\n~~~~\t \n@Ada"
    assert refs(valid_tilde_close, (2, "Ada")) == [
        (2, valid_tilde_close.rfind("@Ada"), len(valid_tilde_close))
    ]


def test_excludes_only_resolved_markdown_reference_links() -> None:
    body = (
        "[@Ada][owner] [@Ada][] [@Ada] [@Ada][missing] [unclosed @Ada\n"
        "   [owner]: https://example.invalid/x\n"
        "[@Ada]: https://example.invalid/y"
    )
    found = refs(body, (2, "Ada"))
    assert [body[start:end] for _, start, end in found] == ["@Ada", "@Ada"]
    assert [start for _, start, _ in found] == [
        body.index("[@Ada][missing]") + 1,
        body.index("@Ada", body.index("[unclosed")),
    ]


def test_complex_inline_links_pair_deterministically() -> None:
    body = r"[outer [@Ada] escaped \] label](https://x.test/a_(b)) then @Ada"
    found = refs(body, (2, "Ada"))
    assert found == [(2, body.rfind("@Ada"), len(body))]


def test_malformed_inline_link_does_not_hide_occurrence() -> None:
    body = "[@Ada](https://x.test/a_(b) and @Ada"
    found = refs(body, (2, "Ada"))
    assert len(found) == 2


def test_url_balanced_parentheses_and_trailing_boundary() -> None:
    body = "https://x.test/a_(b)/@Ada), then (@Ada)."
    found = refs(body, (2, "Ada"))
    assert found == [(2, body.rfind("@Ada"), body.rfind("@Ada") + 4)]


def test_any_invalid_or_nfkc_casefold_ambiguous_name_disables_syntax() -> None:
    names = (
        MentionName(2, "Ada"),
        MentionName(3, "ＡＤＡ"),
        MentionName(4, "Bad Name"),
        MentionName(5, "Lin"),
    )
    issues = mention_name_issues(names)
    assert [(issue.code, issue.member_ids) for issue in issues] == [
        ("duplicate_name", (2, 3)),
        ("invalid_name", (4,)),
    ]
    assert find_mentions("@Lin", names) == ()


def test_four_space_indented_reference_definition_is_not_resolved() -> None:
    body = "[@Ada][owner]\n    [owner]: https://example.invalid"
    assert refs(body, (2, "Ada")) == [(2, 1, 5)]


def test_www_requires_a_left_token_boundary() -> None:
    body = "xwww.example/@Ada www.example/@Ada then @Ada"
    found = refs(body, (2, "Ada"))
    assert [start for _, start, _ in found] == [
        body.index("@Ada"),
        body.rfind("@Ada"),
    ]


def test_cjk_adjacent_mention_is_not_misclassified_as_email() -> None:
    body = "请@Ada，处理；但mail@Ada.com不应解析"
    assert refs(body, (2, "Ada")) == [(2, 1, 5)]
