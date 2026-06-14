const BASE_URL = "http://127.0.0.1:8000/";

export const uploadAndFetch = async ({ file, endpoint }) => {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    body: formData,
  });
  return await response.json();
};