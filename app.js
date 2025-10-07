// Initialize PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// DOM elements
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const status = document.getElementById('status');
const loader = document.getElementById('loader');
const detectionPreview = document.getElementById('detectionPreview');
const detectionCanvas = document.getElementById('detectionCanvas');
const previewSection = document.getElementById('previewSection');
const originalCanvas = document.getElementById('originalCanvas');
const croppedCanvas = document.getElementById('croppedCanvas');
const downloadBtn = document.getElementById('downloadBtn');
const manualSelectBtn = document.getElementById('manualSelectBtn');
const cancelBtn = document.getElementById('cancelBtn');
const retryBtn = document.getElementById('retryBtn');
const rotateLeftBtn = document.getElementById('rotateLeftBtn');
const rotateRightBtn = document.getElementById('rotateRightBtn');
const rotate180Btn = document.getElementById('rotate180Btn');

let currentCanvas = null;
let detectedRegions = [];
let currentRotation = 0; // Track rotation angle

// Show status
function showStatus(message, type) {
    status.textContent = message;
    status.className = 'status ' + type;
}

// Toggle loader
function toggleLoader(show) {
    loader.style.display = show ? 'block' : 'none';
}

// Drag and drop handlers
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

// Handle file upload
async function handleFile(file) {
    detectionPreview.style.display = 'none';
    previewSection.style.display = 'none';
    
    const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/bmp'];
    if (!validTypes.includes(file.type)) {
        showStatus('Invalid file type. Please upload a PDF or image file.', 'error');
        return;
    }

    toggleLoader(true);
    showStatus('Processing document...', 'info');

    try {
        let imageData;
        
        if (file.type === 'application/pdf') {
            imageData = await processPDF(file);
        } else {
            imageData = await processImage(file);
        }

        currentCanvas = imageData;
        displayOriginal(imageData);
        await detectFaces(imageData);

    } catch (error) {
        showStatus('Error: ' + error.message, 'error');
        console.error(error);
    } finally {
        toggleLoader(false);
    }
}

// Process PDF file
async function processPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({scale: 3});
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({canvasContext: context, viewport: viewport}).promise;
    return canvas;
}

// Process image file
async function processImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(canvas);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Display original image
function displayOriginal(canvas) {
    const ctx = originalCanvas.getContext('2d');
    const maxWidth = 350;
    const scale = Math.min(1, maxWidth / canvas.width);
    originalCanvas.width = canvas.width * scale;
    originalCanvas.height = canvas.height * scale;
    ctx.drawImage(canvas, 0, 0, originalCanvas.width, originalCanvas.height);
}

// Preprocess image for better detection
function preprocessImage(canvas) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Increase contrast
    const factor = 1.5;
    for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, ((data[i] - 128) * factor) + 128);
        data[i + 1] = Math.min(255, ((data[i + 1] - 128) * factor) + 128);
        data[i + 2] = Math.min(255, ((data[i + 2] - 128) * factor) + 128);
    }
    
    ctx.putImageData(imageData, 0, 0);
    return tempCanvas;
}

// Detect faces with region-based approach
async function detectFaces(canvas) {
    showStatus('Detecting faces...', 'info');
    
    // ID photos are typically on right side for horizontal IDs, or top for vertical
    const regions = [
        { x: canvas.width * 0.6, y: 0, width: canvas.width * 0.4, height: canvas.height * 0.5 },  // Top-right
        { x: 0, y: 0, width: canvas.width * 0.4, height: canvas.height * 0.5 },  // Top-left
        { x: canvas.width * 0.5, y: 0, width: canvas.width * 0.5, height: canvas.height },  // Right half
        { x: 0, y: 0, width: canvas.width * 0.5, height: canvas.height }  // Left half
    ];

    let allFaces = [];
    
    for (let region of regions) {
        const regionCanvas = document.createElement('canvas');
        regionCanvas.width = region.width;
        regionCanvas.height = region.height;
        const ctx = regionCanvas.getContext('2d');
        ctx.drawImage(canvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
        
        const preprocessed = preprocessImage(regionCanvas);
        const faces = await detectInRegion(preprocessed);
        
        // Adjust coordinates back to full image
        faces.forEach(face => {
            face.x += region.x;
            face.y += region.y;
        });
        
        allFaces = allFaces.concat(faces);
    }

    // Filter and sort faces
    const validFaces = filterFaces(allFaces, canvas);
    
    if (validFaces.length === 0) {
        showStatus('Auto-detection failed. Use "Manual Selection" to crop the photo.', 'error');
        detectionPreview.style.display = 'block';
        showDetectionCanvas(canvas, []);
        return;
    }

    detectedRegions = validFaces;
    showDetectionCanvas(canvas, validFaces);
    showStatus(`Found ${validFaces.length} face(s). Click on the correct one or use Manual Selection.`, 'success');
}

// Detect faces in a region
function detectInRegion(canvas) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const tracker = new tracking.ObjectTracker('face');
            tracker.setInitialScale(2);
            tracker.setStepSize(1);
            tracker.setEdgesDensity(0.1);

            let faces = [];
            tracker.on('track', (event) => {
                faces = event.data || [];
                resolve(faces);
            });

            tracking.track(img, tracker);
        };
        img.onerror = () => resolve([]);
        img.src = canvas.toDataURL();
    });
}

// Filter out invalid detections
function filterFaces(faces, canvas) {
    return faces.filter(face => {
        const area = face.width * face.height;
        const canvasArea = canvas.width * canvas.height;
        const ratio = area / canvasArea;
        const aspectRatio = face.width / face.height;
        
        // Face should be 0.5-25% of image, reasonable aspect ratio
        return ratio > 0.005 && ratio < 0.25 && aspectRatio > 0.4 && aspectRatio < 2.5;
    }).sort((a, b) => (b.width * b.height) - (a.width * a.height)).slice(0, 5); // Top 5 candidates
}

// Show detection canvas with clickable boxes
function showDetectionCanvas(canvas, faces) {
    detectionPreview.style.display = 'block';
    
    const maxWidth = 700;
    const scale = Math.min(1, maxWidth / canvas.width);
    detectionCanvas.width = canvas.width * scale;
    detectionCanvas.height = canvas.height * scale;
    
    const ctx = detectionCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, 0, detectionCanvas.width, detectionCanvas.height);
    
    // Draw all detected faces
    faces.forEach((face, index) => {
        ctx.strokeStyle = index === 0 ? '#00ff00' : '#ffff00';
        ctx.lineWidth = 3;
        ctx.strokeRect(face.x * scale, face.y * scale, face.width * scale, face.height * scale);
        
        // Add number label
        ctx.fillStyle = index === 0 ? '#00ff00' : '#ffff00';
        ctx.font = 'bold 20px Arial';
        ctx.fillText((index + 1).toString(), face.x * scale + 5, face.y * scale + 25);
    });
    
    // Make canvas clickable only if there are faces
    if (faces.length > 0) {
        detectionCanvas.style.cursor = 'pointer';
        detectionCanvas.onclick = (e) => selectFaceFromClick(e, faces, scale);
    } else {
        detectionCanvas.style.cursor = 'default';
        detectionCanvas.onclick = null;
    }
}

// Select face from click
function selectFaceFromClick(e, faces, scale) {
    const rect = detectionCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    
    for (let face of faces) {
        if (x >= face.x && x <= face.x + face.width && y >= face.y && y <= face.y + face.height) {
            cropFace(face);
            return;
        }
    }
}

// Crop selected face
function cropFace(face) {
    const padding = 0.5;
    const padX = face.width * padding;
    const padY = face.height * padding;

    let x = Math.max(0, face.x - padX);
    let y = Math.max(0, face.y - padY);
    let width = Math.min(currentCanvas.width - x, face.width + 2 * padX);
    let height = Math.min(currentCanvas.height - y, face.height + 2 * padY);

    const ctx = croppedCanvas.getContext('2d');
    croppedCanvas.width = width;
    croppedCanvas.height = height;
    ctx.drawImage(currentCanvas, x, y, width, height, 0, 0, width, height);

    currentRotation = 0; // Reset rotation for new crop
    detectionPreview.style.display = 'none';
    previewSection.style.display = 'block';
    showStatus('Photo extracted successfully!', 'success');
}

// Manual selection mode
manualSelectBtn.addEventListener('click', () => {
    detectionPreview.style.display = 'none';
    enableManualCrop();
});

// Enable manual crop
function enableManualCrop() {
    showStatus('Click and drag to select the photo area on the document', 'info');
    
    // Show a larger version of the original for easier selection
    const tempCanvas = document.createElement('canvas');
    const maxWidth = 700;
    const displayScale = Math.min(1, maxWidth / currentCanvas.width);
    tempCanvas.width = currentCanvas.width * displayScale;
    tempCanvas.height = currentCanvas.height * displayScale;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(currentCanvas, 0, 0, tempCanvas.width, tempCanvas.height);
    
    // Replace detection canvas with the temp canvas for manual selection
    detectionPreview.style.display = 'block';
    detectionCanvas.width = tempCanvas.width;
    detectionCanvas.height = tempCanvas.height;
    const ctx = detectionCanvas.getContext('2d');
    ctx.drawImage(tempCanvas, 0, 0);
    
    detectionCanvas.style.cursor = 'crosshair';
    
    let startX, startY, isDrawing = false;
    const scale = currentCanvas.width / tempCanvas.width;
    
    detectionCanvas.onmousedown = (e) => {
        const rect = detectionCanvas.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        isDrawing = true;
    };
    
    detectionCanvas.onmousemove = (e) => {
        if (!isDrawing) return;
        const rect = detectionCanvas.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        // Redraw image
        ctx.drawImage(tempCanvas, 0, 0);
        
        // Draw selection rectangle
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 3;
        ctx.strokeRect(startX, startY, currentX - startX, currentY - startY);
    };
    
    detectionCanvas.onmouseup = (e) => {
        if (!isDrawing) return;
        const rect = detectionCanvas.getBoundingClientRect();
        const endX = e.clientX - rect.left;
        const endY = e.clientY - rect.top;
        isDrawing = false;
        
        // Calculate selection in original canvas coordinates
        const x = Math.min(startX, endX) * scale;
        const y = Math.min(startY, endY) * scale;
        const width = Math.abs(endX - startX) * scale;
        const height = Math.abs(endY - startY) * scale;
        
        if (width > 20 && height > 20) {
            // Crop selected area
            const cropCtx = croppedCanvas.getContext('2d');
            croppedCanvas.width = width;
            croppedCanvas.height = height;
            cropCtx.drawImage(currentCanvas, x, y, width, height, 0, 0, width, height);
            
            currentRotation = 0; // Reset rotation for new crop
            detectionPreview.style.display = 'none';
            previewSection.style.display = 'block';
            showStatus('Manual crop successful!', 'success');
            
            // Clean up event listeners
            detectionCanvas.style.cursor = 'default';
            detectionCanvas.onmousedown = null;
            detectionCanvas.onmousemove = null;
            detectionCanvas.onmouseup = null;
        } else {
            showStatus('Selection too small. Try again.', 'error');
        }
    };
}

// Cancel detection
cancelBtn.addEventListener('click', () => {
    detectionPreview.style.display = 'none';
    showStatus('Upload canceled. Please try another document.', 'info');
    fileInput.value = '';
});

// Retry
retryBtn.addEventListener('click', () => {
    previewSection.style.display = 'none';
    detectionPreview.style.display = 'none';
    showStatus('Ready to process documents', 'success');
    fileInput.value = '';
});

// Rotation functions
function rotateImage(degrees) {
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    
    // For 90 or 270 degrees, swap width and height
    if (degrees === 90 || degrees === 270) {
        tempCanvas.width = croppedCanvas.height;
        tempCanvas.height = croppedCanvas.width;
    } else {
        tempCanvas.width = croppedCanvas.width;
        tempCanvas.height = croppedCanvas.height;
    }
    
    // Move to center
    tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
    
    // Rotate
    tempCtx.rotate((degrees * Math.PI) / 180);
    
    // Draw image centered
    tempCtx.drawImage(
        croppedCanvas,
        -croppedCanvas.width / 2,
        -croppedCanvas.height / 2
    );
    
    // Update the cropped canvas
    croppedCanvas.width = tempCanvas.width;
    croppedCanvas.height = tempCanvas.height;
    const ctx = croppedCanvas.getContext('2d');
    ctx.drawImage(tempCanvas, 0, 0);
    
    // Update rotation tracking
    currentRotation = (currentRotation + degrees) % 360;
}

// Rotate left (counter-clockwise)
rotateLeftBtn.addEventListener('click', () => {
    rotateImage(-90);
    showStatus('Rotated 90° left', 'success');
});

// Rotate right (clockwise)
rotateRightBtn.addEventListener('click', () => {
    rotateImage(90);
    showStatus('Rotated 90° right', 'success');
});

// Rotate 180 degrees
rotate180Btn.addEventListener('click', () => {
    rotateImage(180);
    showStatus('Rotated 180°', 'success');
});

// Download
downloadBtn.addEventListener('click', () => {
    croppedCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'extracted_photo_' + Date.now() + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
});