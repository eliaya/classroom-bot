from __future__ import annotations
import pytest
import discord
from src.embed_builder import EmbedBuilder, truncate_text, parse_materials
from src.message_templates import default_template


class _DefaultMessages:
    """Minimal MessageStore stand-in: renders the in-code default templates."""

    async def render(self, key: str, **params: object) -> str:
        return default_template(key).format(**params)


def test_truncate_text():
    """Verify text truncation complies with standard boundaries."""
    assert truncate_text(None) == "*No description provided.*"
    assert truncate_text("test") == "test"
    
    long_txt = "A" * 1050
    truncated = truncate_text(long_txt, limit=1000)
    assert len(truncated) == 1000
    assert truncated.endswith("...")


def test_parse_materials():
    """Verify material parses correctly format URLs and titles from list schemas."""
    mock_materials = [
        {
            "driveFile": {
                "driveFile": {
                    "title": "Syllabus.pdf",
                    "alternateLink": "https://drive.google.com/syllabus"
                }
            }
        },
        {
            "youtubeVideo": {
                "title": "Class Lecture 1",
                "alternateLink": "https://youtube.com/class1"
            }
        },
        {
            "link": {
                "title": "Reference Website",
                "url": "https://example.com"
            }
        }
    ]

    parsed = parse_materials(mock_materials)
    assert len(parsed) == 3
    assert "📁 [Drive: Syllabus.pdf]" in parsed[0]
    assert "🎥 [YouTube: Class Lecture 1]" in parsed[1]
    assert "🔗 [Link: Reference Website]" in parsed[2]


@pytest.mark.asyncio
async def test_build_announcement_embed():
    """Test generating a structured google announcement text embed."""
    mock_announcement = {
        "id": "ann123",
        "text": "Hello Students, read chapter 2.",
        "alternateLink": "https://classroom.google.com/ann",
        "updateTime": "2026-06-08T04:35:29Z",
        "creatorUserId": "usrTeacher",
        "materials": [
            {
                "link": {
                    "title": "Chapter 2 notes",
                    "url": "https://example.com/ch2"
                }
            }
        ]
    }

    embed = await EmbedBuilder.build_announcement_embed(_DefaultMessages(), "Math 101", mock_announcement)

    assert isinstance(embed, discord.Embed)
    assert "Announcement" in embed.title
    assert "Math 101" in embed.title
    assert "Hello Students" in embed.description
    assert embed.url == "https://classroom.google.com/ann"
    assert len(embed.fields) == 1
    assert embed.fields[0].name == "Attachments & Materials"
    assert "Chapter 2 notes" in embed.fields[0].value


@pytest.mark.asyncio
async def test_build_coursework_embed():
    """Test generating a structured coursework Assignment orange embed."""
    mock_coursework = {
        "id": "cw456",
        "title": "Homework Part A",
        "description": "Solve exercises 1-5.",
        "alternateLink": "https://classroom.google.com/cw",
        "updateTime": "2026-06-08T04:35:29Z",
        "maxPoints": 100,
        "dueDate": {"year": 2026, "month": 6, "day": 15},
        "dueTime": {"hour": 23, "minute": 59}
    }

    embed = await EmbedBuilder.build_coursework_embed(_DefaultMessages(), "Science 101", mock_coursework)

    assert isinstance(embed, discord.Embed)
    assert "Assignment Assigned" in embed.title
    assert "Science 101" in embed.fields[0].value
    assert "100 points" in embed.fields[1].value
    assert "2026-06-15" in embed.fields[2].value
