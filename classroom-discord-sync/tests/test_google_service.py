from __future__ import annotations
from unittest.mock import MagicMock, patch
import pytest
from src.google_service import GoogleClassroomService, google_service


@pytest.mark.asyncio
@patch("src.google_service.build")
async def test_api_service_build(mock_build):
    """Test standard service loading and credential checks."""
    # Setup mocks
    service = GoogleClassroomService()
    service.creds = MagicMock()
    service.creds.valid = True

    mock_service_instance = MagicMock()
    mock_build.return_value = mock_service_instance

    # Trigger API creation
    api_client = service._get_api_service()
    
    assert api_client == mock_service_instance
    mock_build.assert_called_with("classroom", "v1", credentials=service.creds)


@pytest.mark.asyncio
@patch("src.google_service.google_service._get_api_service")
async def test_list_courses(mock_get_api):
    """Verify list_courses maps the Google Classroom execute response JSON structures correctly."""
    # Setup mock chain
    mock_service = MagicMock()
    mock_get_api.return_value = mock_service
    
    mock_response = {
        "courses": [
            {"id": "c1", "name": "Algebra", "section": "Sec A"},
            {"id": "c2", "name": "History", "section": "Sec B"}
        ]
    }
    mock_service.courses().list().execute.return_value = mock_response

    # Execute
    courses = await google_service.list_courses()

    assert len(courses) == 2
    assert courses[0]["id"] == "c1"
    assert courses[0]["name"] == "Algebra"
    assert courses[1]["id"] == "c2"


@pytest.mark.asyncio
@patch("src.google_service.google_service._get_api_service")
async def test_get_course(mock_get_api):
    """Verify single course detail endpoint queries mock responses."""
    mock_service = MagicMock()
    mock_get_api.return_value = mock_service
    
    mock_course = {"id": "c1", "name": "Biology", "alternateLink": "https://classroom/biology"}
    mock_service.courses().get(id="c1").execute.return_value = mock_course

    course = await google_service.get_course("c1")

    assert course is not None
    assert course["id"] == "c1"
    assert course["name"] == "Biology"
    assert course["alternateLink"] == "https://classroom/biology"


@pytest.mark.asyncio
@patch("src.google_service.google_service._get_api_service")
async def test_create_announcement(mock_get_api):
    """Test manual text announcements are routed and returned cleanly."""
    mock_service = MagicMock()
    mock_get_api.return_value = mock_service
    
    mock_response = {"id": "ann999", "alternateLink": "https://classroom/ann/999"}
    mock_service.courses().announcements().create().execute.return_value = mock_response

    res = await google_service.create_announcement("c1", "Attention class!")

    assert res["id"] == "ann999"
    assert res["alternateLink"] == "https://classroom/ann/999"


@pytest.mark.asyncio
@patch("src.google_service.google_service._get_api_service")
async def test_list_student_submissions(mock_get_api):
    """Verify student submissions are returned from the Classroom API list endpoint."""
    mock_service = MagicMock()
    mock_get_api.return_value = mock_service

    mock_response = {
        "studentSubmissions": [
            {"id": "sub1", "courseWorkId": "cw1", "state": "NEW"},
            {"id": "sub2", "courseWorkId": "cw2", "state": "CREATED"},
        ]
    }
    mock_service.courses().courseWork().studentSubmissions().list().execute.return_value = mock_response

    res = await google_service.list_student_submissions("c1")

    assert len(res) == 2
    assert res[0]["id"] == "sub1"
    assert res[1]["state"] == "CREATED"
