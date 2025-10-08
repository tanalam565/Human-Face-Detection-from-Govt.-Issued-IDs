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
let currentRotation = 0;

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
        
        // Auto-straighten document if necessary
        showStatus('Checking document orientation...', 'info');
        const straightenedCanvas = await autoStraightenDocument(currentCanvas);
        if (straightenedCanvas !== currentCanvas) {
            showStatus('Document auto-corrected for proper orientation', 'success');
            currentCanvas = straightenedCanvas;
        }
        
        displayOriginal(currentCanvas);
        
        // Auto-detect faces after straightening
        await detectFaces(currentCanvas);

    } catch (error) {
        showStatus('Error: ' + error.message, 'error');
        console.error(error);
    } finally {
        toggleLoader(false);
    }
}


// Auto-straighten document by testing all 4 orientations
async function autoStraightenDocument(canvas) {
    try {
        showStatus('Testing all orientations to find correct rotation...', 'info');
        
        // Create a better quality version for OCR
        const testCanvas = document.createElement('canvas');
        const scale = Math.min(1, 1500 / Math.max(canvas.width, canvas.height));
        testCanvas.width = canvas.width * scale;
        testCanvas.height = canvas.height * scale;
        const ctx = testCanvas.getContext('2d');
        
        // Draw with better quality
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, 0, 0, testCanvas.width, testCanvas.height);
        
        // Preprocess for better OCR
        const preprocessed = preprocessForOCR(testCanvas);
        
        // Test all 4 orientations
        const orientations = [
            { angle: 0, name: '0° (original)' },
            { angle: 90, name: '90° clockwise' },
            { angle: 180, name: '180° (upside down)' },
            { angle: 270, name: '270° clockwise (90° counter-clockwise)' }
        ];
        const results = [];
        
        for (let orientation of orientations) {
            const angle = orientation.angle;
            console.log(`\n=== Testing ${orientation.name} ===`);
            showStatus(`Testing ${orientation.name}...`, 'info');
            
            // Rotate canvas to test this orientation
            const rotatedCanvas = angle === 0 ? preprocessed : rotateCanvasBy(preprocessed, angle);
            
            // Run OCR with better settings
            console.log('Running OCR...');
            const result = await Tesseract.recognize(
                rotatedCanvas.toDataURL('image/png'),
                'eng',
                {
                    logger: (m) => {
                        if (m.status === 'recognizing text') {
                            const progress = Math.round(m.progress * 100);
                            if (progress % 25 === 0) {
                                console.log(`  Progress: ${progress}%`);
                            }
                        }
                    },
                    tessedit_pageseg_mode: Tesseract.PSM.AUTO
                }
            );
            
            // Analyze results
            const words = result.data.words || [];
            const allWords = words.length;
            const goodWords = words.filter(w => w.confidence > 50);
            const greatWords = words.filter(w => w.confidence > 70);
            
            const totalConfidence = goodWords.reduce((sum, w) => sum + w.confidence, 0);
            const avgConfidence = goodWords.length > 0 ? totalConfidence / goodWords.length : 0;
            
            // Count alphanumeric characters
            const text = result.data.text || '';
            const alphanumericCount = (text.match(/[A-Za-z0-9]/g) || []).length;
            const textLength = text.trim().length;
            
            // Calculate score with better weighting
            const score = (greatWords.length * 30) + (goodWords.length * 15) + (avgConfidence * 2) + (alphanumericCount * 3);
            
            results.push({
                angle: angle,
                name: orientation.name,
                score: score,
                allWords: allWords,
                goodWords: goodWords.length,
                greatWords: greatWords.length,
                avgConfidence: avgConfidence,
                charCount: alphanumericCount,
                textLength: textLength,
                sampleText: text.substring(0, 150).trim()
            });
            
            console.log(`Results for ${orientation.name}:`);
            console.log(`  Total words detected: ${allWords}`);
            console.log(`  Good words (>50% conf): ${goodWords.length}`);
            console.log(`  Great words (>70% conf): ${greatWords.length}`);
            console.log(`  Average confidence: ${avgConfidence.toFixed(1)}%`);
            console.log(`  Alphanumeric chars: ${alphanumericCount}`);
            console.log(`  Text length: ${textLength}`);
            console.log(`  SCORE: ${score.toFixed(1)}`);
            if (text.trim()) {
                console.log(`  Sample text: "${text.substring(0, 100).trim()}"`);
            } else {
                console.log(`  Sample text: [NO TEXT DETECTED]`);
            }
        }
        
        // Sort by score (highest = most readable)
        results.sort((a, b) => b.score - a.score);
        
        console.log('\n========================================');
        console.log('=== FINAL RESULTS ===');
        console.log('========================================');
        results.forEach((r, i) => {
            const marker = i === 0 ? '👑 WINNER' : '';
            console.log(`${i + 1}. ${r.name}: Score=${r.score.toFixed(1)}, Words=${r.goodWords}/${r.allWords}, Conf=${r.avgConfidence.toFixed(1)}% ${marker}`);
        });
        console.log('========================================\n');
        
        const best = results[0];
        const second = results[1];
        
        // More lenient thresholds
        const scoreRatio = second.score > 0 ? best.score / second.score : 999;
        
        console.log(`Best: ${best.name} (score: ${best.score.toFixed(1)})`);
        console.log(`Second: ${second.name} (score: ${second.score.toFixed(1)})`);
        console.log(`Ratio: ${scoreRatio.toFixed(2)}x better`);
        
        // Apply rotation if best orientation is better
        if (best.angle !== 0 && (best.score > second.score * 1.15 || best.goodWords >= 2)) {
            console.log(`\n✅ AUTO-ROTATING document by ${best.angle}°`);
            console.log(`Reason: ${best.name} is clearly more readable\n`);
            showStatus(`Document auto-corrected (rotated ${best.angle}°)`, 'success');
            return rotateCanvasBy(canvas, best.angle);
        } else if (best.angle === 0) {
            console.log('\n✅ Document is already correctly oriented\n');
            showStatus('Document orientation is correct', 'success');
            return canvas;
        } else {
            console.log('\n⚠️ No clear best orientation, keeping original\n');
            showStatus('Keeping original orientation', 'info');
            return canvas;
        }
        
    } catch (error) {
        console.error('Orientation detection failed:', error);
        showStatus('Orientation detection failed, using original', 'error');
        return canvas;
    }
}

// Preprocess image for better OCR
function preprocessForOCR(canvas) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    
    // Draw original
    ctx.drawImage(canvas, 0, 0);
    
    // Get image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Convert to grayscale and enhance contrast
    for (let i = 0; i < data.length; i += 4) {
        // Grayscale
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        
        // Increase contrast
        const contrast = 1.3;
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
        const enhanced = factor * (gray - 128) + 128;
        const final = Math.max(0, Math.min(255, enhanced));
        
        data[i] = data[i + 1] = data[i + 2] = final;
    }
    
    ctx.putImageData(imageData, 0, 0);
    return tempCanvas;
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

// Rotate canvas by degrees
function rotateCanvasBy(canvas, degrees) {
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    
    // For 90 or 270 degrees, swap width and height
    if (Math.abs(degrees) === 90 || Math.abs(degrees) === 270) {
        tempCanvas.width = canvas.height;
        tempCanvas.height = canvas.width;
    } else {
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
    }
    
    // Move to center
    tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
    
    // Rotate
    tempCtx.rotate((degrees * Math.PI) / 180);
    
    // Draw image centered
    tempCtx.drawImage(
        canvas,
        -canvas.width / 2,
        -canvas.height / 2
    );
    
    return tempCanvas;
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
        showStatus('No faces detected. Try "Rotate & Retry" or "Manual Selection".', 'error');
        detectionPreview.style.display = 'block';
        showDetectionCanvas(canvas, []);
        setupRetryButtons();
        return;
    }

    detectedRegions = validFaces;
    showDetectionCanvas(canvas, validFaces);
    setupRetryButtons();
    showStatus(`Found ${validFaces.length} face(s). Click on one, or use "Rotate & Retry"/"Manual Selection".`, 'success');
}

// Setup retry buttons
function setupRetryButtons() {
    manualSelectBtn.textContent = 'Manual Selection';
    manualSelectBtn.onclick = () => {
        detectionPreview.style.display = 'none';
        enableManualCrop();
    };
    
    cancelBtn.textContent = '↺ Rotate & Retry';
    cancelBtn.style.background = '#2196F3';
    cancelBtn.onclick = rotateAndRetry;
}

// Rotate document and retry detection
async function rotateAndRetry() {
    // Rotate document 90 degrees counterclockwise
    currentCanvas = rotateCanvasBy(currentCanvas, -90);
    
    // Update displays
    displayOriginal(currentCanvas);
    
    // Re-run face detection
    toggleLoader(true);
    await detectFaces(currentCanvas);
    toggleLoader(false);
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
    }).sort((a, b) => (b.width * b.height) - (a.width * a.height)).slice(0, 5);
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

    currentRotation = 0;
    detectionPreview.style.display = 'none';
    previewSection.style.display = 'block';
    showStatus('Photo extracted successfully!', 'success');
}

// Enable manual crop
function enableManualCrop() {
    showStatus('Click and drag to select the photo area on the document', 'info');
    
    const tempCanvas = document.createElement('canvas');
    const maxWidth = 700;
    const displayScale = Math.min(1, maxWidth / currentCanvas.width);
    tempCanvas.width = currentCanvas.width * displayScale;
    tempCanvas.height = currentCanvas.height * displayScale;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(currentCanvas, 0, 0, tempCanvas.width, tempCanvas.height);
    
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
        
        ctx.drawImage(tempCanvas, 0, 0);
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
        
        const x = Math.min(startX, endX) * scale;
        const y = Math.min(startY, endY) * scale;
        const width = Math.abs(endX - startX) * scale;
        const height = Math.abs(endY - startY) * scale;
        
        if (width > 20 && height > 20) {
            const cropCtx = croppedCanvas.getContext('2d');
            croppedCanvas.width = width;
            croppedCanvas.height = height;
            cropCtx.drawImage(currentCanvas, x, y, width, height, 0, 0, width, height);
            
            currentRotation = 0;
            detectionPreview.style.display = 'none';
            previewSection.style.display = 'block';
            showStatus('Manual crop successful!', 'success');
            
            detectionCanvas.style.cursor = 'default';
            detectionCanvas.onmousedown = null;
            detectionCanvas.onmousemove = null;
            detectionCanvas.onmouseup = null;
        } else {
            showStatus('Selection too small. Try again.', 'error');
        }
    };
}

// Retry
retryBtn.addEventListener('click', () => {
    previewSection.style.display = 'none';
    detectionPreview.style.display = 'none';
    showStatus('Ready to process documents', 'success');
    fileInput.value = '';
});

// Rotation functions for extracted photo
function rotateImage(degrees) {
    const rotated = rotateCanvasBy(croppedCanvas, degrees);
    croppedCanvas.width = rotated.width;
    croppedCanvas.height = rotated.height;
    const ctx = croppedCanvas.getContext('2d');
    ctx.drawImage(rotated, 0, 0);
    currentRotation = (currentRotation + degrees) % 360;
}

rotateLeftBtn.addEventListener('click', () => {
    rotateImage(-90);
    showStatus('Rotated 90° left', 'success');
});

rotateRightBtn.addEventListener('click', () => {
    rotateImage(90);
    showStatus('Rotated 90° right', 'success');
});

rotate180Btn.addEventListener('click', () => {
    rotateImage(180);
    showStatus('Rotated 180°', 'success');
});

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