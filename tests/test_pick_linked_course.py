from src.cogs.classroom import ClassroomCog
from src.models import GuildCourseLink


def _link(course_id: str) -> GuildCourseLink:
    return GuildCourseLink(guild_id=1, course_id=course_id, channel_id=1)


def test_no_links_returns_error():
    cid, err = ClassroomCog._pick_linked_course([])
    assert cid is None and err is not None


def test_single_link_resolves():
    cid, err = ClassroomCog._pick_linked_course([_link("abc")])
    assert cid == "abc" and err is None


def test_multiple_links_returns_error():
    cid, err = ClassroomCog._pick_linked_course([_link("a"), _link("b")])
    assert cid is None and err is not None and "a" in err and "b" in err
