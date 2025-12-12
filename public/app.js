const recommendBtn = document.getElementById("recommendBtn");
const resetBtn = document.getElementById("resetBtn");
const resultsBox = document.getElementById("results");

async function recommend() {
  const username = document.getElementById("username").value.trim();
  const genre = document.getElementById("genre").value;
  const startYear = document.getElementById("startYear").value;
  const endYear = document.getElementById("endYear").value;
  const preference = document.getElementById("preference").value;

  if (!username || !startYear || !endYear) {
    alert("Please fill in username and year range.");
    return;
  }

  resultsBox.innerHTML = `<p class="placeholder">Loading recommendations...</p>`;

  try {
    const res = await fetch(`/api/recommend?username=${username}&genre=${genre}&startYear=${startYear}&endYear=${endYear}&preference=${preference}`);
    const data = await res.json();

    if (!data.success) {
      resultsBox.innerHTML = `<p class="placeholder">${data.error}</p>`;
      return;
    }

    if (data.results.length === 0) {
      resultsBox.innerHTML = `<p class="placeholder">No recommendations found.</p>`;
      return;
    }

    resultsBox.innerHTML = "";
    data.results.forEach(film => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <img src="${film.poster || 'placeholder.jpg'}" alt="${film.title}">
        <h3>${film.title} (${film.year})</h3>
        <p><strong>Director:</strong> ${film.director}</p>
        <p>${film.overview}</p>
      `;

      card.addEventListener("click", () => createModal(film));
      resultsBox.appendChild(card);
    });

  } catch (err) {
    resultsBox.innerHTML = `<p class="placeholder">Error fetching recommendations.</p>`;
    console.error(err);
  }
}

async function reset() {
  const username = document.getElementById("username").value.trim();
  if (!username) return;
  await fetch(`/api/reset?username=${username}`);
  resultsBox.innerHTML = `<p class="placeholder">Recommendations reset. Click "Get Recommendations" again.</p>`;
}

function createModal(film) {
  const modal = document.createElement("div");
  modal.className = "modal show";

  modal.innerHTML = `
    <div class="modal-content">
      <img src="${film.poster || 'placeholder.jpg'}" alt="${film.title}">
      <div class="info">
        <h2>${film.title} (${film.year})</h2>
        <p><strong>Director:</strong> ${film.director}</p>
        <p>${film.overview}</p>
      </div>
      <span class="close-btn">&times;</span>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector(".close-btn").addEventListener("click", () => {
    modal.classList.remove("show");
    setTimeout(() => document.body.removeChild(modal), 300);
  });

  modal.addEventListener("click", e => {
    if (e.target === modal) {
      modal.classList.remove("show");
      setTimeout(() => document.body.removeChild(modal), 300);
    }
  });
}

recommendBtn.addEventListener("click", recommend);
resetBtn.addEventListener("click", reset);